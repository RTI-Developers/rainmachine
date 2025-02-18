const enablePollingConfigKey = 'EnablePolling';
const enableTraceConfigKey = 'EnableTrace';
const hostConfigKey = 'IPAddress';
const passwordConfigKey = 'Password';
const modelCodeConfigKey = 'Model';
const pollingIntervalConfigKey = 'PollingInterval';
const portConfigKey = 'Port';
const programCountConfigKey = 'ZoneCount';
const programListConfigKey = 'ProgramList';
const zoneCountConfigKey = 'ZoneCount';
const zoneListConfigKey = 'ZoneList';

const programCount = parseInt(Config.Get(programCountConfigKey));
const programList = new SystemVarsList<string>(programListConfigKey);
const zoneCount = parseInt(Config.Get(zoneCountConfigKey));
const zoneList = new SystemVarsList<string>(zoneListConfigKey);
const logger = new Logger('Rain Machine Driver:', Config.Get(enableTraceConfigKey) == 'true');
const refreshTimer = new Timer();

enum LicenseState {
    DemoExpired = 0,
    DemoActive = 1,
    Licensed = 2
}

let device: RainMachine.Device;
let selectedProgramIndex = -1;
let selectedZoneIndex = -1;

function Init() {
    logger.logInfo('Initializing...');

    device = new RainMachine.Device(
        Config.Get(modelCodeConfigKey) as RainMachine.Model,
        Config.Get(hostConfigKey),
        parseInt(Config.Get(portConfigKey)),
        Config.Get(passwordConfigKey),
        Config.Get(enablePollingConfigKey) === 'true' ? parseInt(Config.Get(pollingIntervalConfigKey)) * 1000 : 0,
        logger,
        OnCommRx,
        OnConnect,
        OnConnectFailure,
        OnDisconnect,
        OnPollingTimer,
        OnSslHandshake,
        OnSslHandshakeFailure,
        OnStateChanged
    );
}

function OnCommRx(data: string) { device.OnCommRx(data); }
function OnConnect() { device.OnConnect(); }
function OnConnectFailure() { device.OnConnectFailure(); }
function OnDisconnect() { device.OnDisconnect(); }
function OnPollingTimer() { device.OnPollingTimer(); }
function OnSslHandshake() { device.OnSslHandshake(); }
function OnSslHandshakeFailure() { device.OnSslHandshakeFailure(); }

function OnStateChanged() {
    logger.logTrace('OnStateChanged');

    logger.logTrace('Updating Program List');
    const programListLength = Math.min(device.Programs.length, programCount);
    if (programListLength !== programList.Size) {
        logger.logTrace('Updating programList, adding [' + programListLength + '] items');
        programList.Open();
        programList.RemoveAll();

        for (let i = 0; i < programListLength; i++) {
            logger.logTrace('Adding program [' + device.Programs[i].name + '] to programList');
            programList.Insert(device.Programs[i].name);
        }
        programList.Close();

        if (selectedProgramIndex < 0 || selectedProgramIndex >= programList.Size) { selectedProgramIndex = 0; }
    }
    
    logger.logTrace('Updating Programs');
    let foundRunningProgram = false;
    for (let i = 0; i < programListLength; i++) {
        const program = device.Programs[i];

        SystemVars.Write('Program' + (i + 1) + 'Uid', program.uid);
        SystemVars.Write('Program' + (i + 1) + 'Name', program.name);
        SystemVars.Write('Program' + (i + 1) + 'Active', program.active);
        SystemVars.Write('Program' + (i + 1) + 'StartTime', program.startTime);
        SystemVars.Write('Program' + (i + 1) + 'Cycles', program.cycles);
        SystemVars.Write('Program' + (i + 1) + 'Soak', program.soak);
        SystemVars.Write('Program' + (i + 1) + 'CsOn', program.cs_on);
        SystemVars.Write('Program' + (i + 1) + 'Delay', program.delay);
        SystemVars.Write('Program' + (i + 1) + 'DelayOn', program.delay_on);
        SystemVars.Write('Program' + (i + 1) + 'Status', program.status);
        SystemVars.Write('Program' + (i + 1) + 'StartTimeParams', program.startTimeParams.offsetMinutes + 'm ' + (program.startTimeParams.offsetSign < 0 ? 'Before ' : 'After ') + RainMachine.StartTimeType[program.startTimeParams.type]);
        SystemVars.Write('Program' + (i + 1) + 'FrequencyType', program.frequency.type);
        SystemVars.Write('Program' + (i + 1) + 'FrequencyParam', program.frequency.param);
        SystemVars.Write('Program' + (i + 1) + 'IgnoreInternetWeather', program.ignoreInternetWeather);
        SystemVars.Write('Program' + (i + 1) + 'FutureField1', program.futureField1);
        SystemVars.Write('Program' + (i + 1) + 'FreqModified', program.freq_modified);
        SystemVars.Write('Program' + (i + 1) + 'UseWaterSense', program.useWaterSense);
        SystemVars.Write('Program' + (i + 1) + 'NextRun', program.nextRun ?? '');
        SystemVars.Write('Program' + (i + 1) + 'StartDate', program.startDate ?? '');
        SystemVars.Write('Program' + (i + 1) + 'EndDate', program.endDate ?? '');
        SystemVars.Write('Program' + (i + 1) + 'YearlyRecurring', program.yearlyRecurring);
        SystemVars.Write('Program' + (i + 1) + 'SimulationExpired', program.simulationExpired);

        if (program.status == RainMachine.ProgramStatus.Running) {
            logger.logTrace('Found running program, name: [' + program.name + ']');

            foundRunningProgram = true;
            SystemVars.Write('RunningProgramName', program.name);
            SystemVars.Write('RunningProgramStartTime', program.startTime);
        }

        logger.logTrace('Updating Program Watering Times');
        const wateringTimeListLength = Math.min(program.wateringTimes.length, zoneCount);
        for (let j = 0; j < wateringTimeListLength; j++) {
            const wateringTime = program.wateringTimes[j];
    
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'Id', wateringTime.id);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'Order', wateringTime.order);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'Name', wateringTime.name);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'Duration', wateringTime.duration);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'Active', wateringTime.active);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'UserPercentage', wateringTime.userPercentage);
            SystemVars.Write('Program' + (j + 1) + 'Zone' + wateringTime.id + 'MinRuntimeCoef', wateringTime.minRuntimeCoef);
        }
    }

    if (!foundRunningProgram) {
        logger.logTrace('No running program found');

        SystemVars.Write('RunningProgramName', '');
        SystemVars.Write('RunningProgramStartTime', '');
    }

    logger.logTrace('Updating Current Restictions');
    SystemVars.Write('CurrentRestrictionHourly', device.Restrictions?.hourly ?? false);
    SystemVars.Write('CurrentRestrictionFreeze', device.Restrictions?.freeze ?? false);
    SystemVars.Write('CurrentRestrictionMonth', device.Restrictions?.month ?? false);
    SystemVars.Write('CurrentRestrictionWeekDay', device.Restrictions?.weekDay ?? false);
    SystemVars.Write('CurrentRestrictionRainDelay', device.Restrictions?.rainDelay ?? false);
    SystemVars.Write('CurrentRestrictionRainDelayCounter', device.Restrictions?.rainDelayCounter ?? 0);
    SystemVars.Write('CurrentRestrictionRainSensor', device.Restrictions?.rainSensor ?? false);
    SystemVars.Write('CurrentRestrictionLastLeakDetected', device.Restrictions?.lastLeakDetected ?? 0);

    logger.logTrace('Updating Zone List');
    const zoneListLength = Math.min(device.Zones.length, zoneCount);
    if (zoneListLength !== zoneList.Size) {
        logger.logTrace('Updating zoneList, adding [' + zoneListLength + '] items');
        zoneList.Open();
        zoneList.RemoveAll();

        for (let i = 0; i < zoneListLength; i++) {
            logger.logTrace('Adding zone [' + device.Zones[i].name + '] to zoneList');
            zoneList.Insert(device.Zones[i].name);
        }
        zoneList.Close();

        if (selectedZoneIndex < 0 || selectedZoneIndex >= zoneList.Size) { selectedZoneIndex = 0; }
    }

    logger.logTrace('Updating Zones');
    let foundRunningZone = false;
    for (let i = 0; i < zoneListLength; i++) {
        const zone = device.Zones[i];

        SystemVars.Write('Zone' + (i + 1) + 'Active', zone.active);
        SystemVars.Write('Zone' + (i + 1) + 'Cycle', zone.cycle);
        SystemVars.Write('Zone' + (i + 1) + 'MachineDuration', zone.machineDuration);
        SystemVars.Write('Zone' + (i + 1) + 'Name', zone.name);
        SystemVars.Write('Zone' + (i + 1) + 'NumberOfCycles', zone.noOfCycles);
        SystemVars.Write('Zone' + (i + 1) + 'Remaining', zone.remaining);
        SystemVars.Write('Zone' + (i + 1) + 'Restriction', zone.restriction);
        SystemVars.Write('Zone' + (i + 1) + 'State', zone.state);
        SystemVars.Write('Zone' + (i + 1) + 'UserDuration', zone.userDuration);

        if (zone.state == RainMachine.ZoneState.Running) {
            logger.logTrace('Found running zone, name: [' + zone.name + ']');

            foundRunningZone = true;
            SystemVars.Write('RunningZoneName', zone.name);
            SystemVars.Write('RunningZoneRemaining', zone.remaining);
        }
    }

    if (!foundRunningZone) {
        logger.logTrace('No running zone found');

        foundRunningZone = true;
        SystemVars.Write('RunningZoneName', '');
        SystemVars.Write('RunningZoneRemaining', 0);
    }

    // Update SelectedProgram & SelectedZone variables to reflect any program/zone changes
    SelectProgram(selectedProgramIndex);
    SelectZone(selectedZoneIndex);
}

function Refresh() {
    logger.logTrace('Refresh');

    device.SendProgramsRequest();
    device.SendZonesRequest();
    device.SendRestrictionsRequest();
}

function SelectProgram(index: number) {
    logger.logTrace('SelectProgram');

    if (index < 0) { return; }

    if (index >= programList.Size) {
        logger.logError('SelectProgram index out of bounds');
        return;
    }

    selectedProgramIndex = index;

    const program = device.Programs[index];

    SystemVars.Write('SelectedProgramUid', program.uid);
    SystemVars.Write('SelectedProgramName', program.name);
    SystemVars.Write('SelectedProgramActive', program.active);
    SystemVars.Write('SelectedProgramStartTime', program.startTime);
    SystemVars.Write('SelectedProgramCycles', program.cycles);
    SystemVars.Write('SelectedProgramSoak', program.soak);
    SystemVars.Write('SelectedProgramCsOn', program.cs_on);
    SystemVars.Write('SelectedProgramDelay', program.delay);
    SystemVars.Write('SelectedProgramDelayOn', program.delay_on);
    SystemVars.Write('SelectedProgramStatus', program.status);
    SystemVars.Write('SelectedProgramStartTimeParams', program.startTimeParams.offsetMinutes + 'm ' + (program.startTimeParams.offsetSign < 0 ? 'Before ' : 'After ') + RainMachine.StartTimeType[program.startTimeParams.type]);
    SystemVars.Write('SelectedProgramFrequencyType', program.frequency.type);
    SystemVars.Write('SelectedProgramFrequencyParam', program.frequency.param);
    SystemVars.Write('SelectedProgramIgnoreInternetWeather', program.ignoreInternetWeather);
    SystemVars.Write('SelectedProgramFutureField1', program.futureField1);
    SystemVars.Write('SelectedProgramFreqModified', program.freq_modified);
    SystemVars.Write('SelectedProgramUseWaterSense', program.useWaterSense);
    SystemVars.Write('SelectedProgramNextRun', program.nextRun ?? '');
    SystemVars.Write('SelectedProgramStartDate', program.startDate ?? '');
    SystemVars.Write('SelectedProgramEndDate', program.endDate ?? '');
    SystemVars.Write('SelectedProgramYearlyRecurring', program.yearlyRecurring);
    SystemVars.Write('SelectedProgramSimulationExpired', program.simulationExpired);

    const wateringTimeListLength = Math.min(program.wateringTimes.length, zoneCount);
    for (let i = 0; i < wateringTimeListLength; i++) {
        const wateringTime = program.wateringTimes[i];

        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'Id', wateringTime.id);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'Order', wateringTime.order);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'Name', wateringTime.name);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'Duration', wateringTime.duration);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'Active', wateringTime.active);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'UserPercentage', wateringTime.userPercentage);
        SystemVars.Write('SelectedProgramZone' + (i + 1) + 'MinRuntimeCoef', wateringTime.minRuntimeCoef);
    }
}

function SelectZone(index: number) {
    logger.logTrace('SelectZone');

    if (index < 0) {
        return;
    }

    if (index >= zoneList.Size) {
        logger.logError('SelectZone index out of bounds');
        return;
    }

    selectedZoneIndex = index;

    const zone = device.Zones[index];

    SystemVars.Write('SelectedZoneActive', zone.active);
    SystemVars.Write('SelectedZoneCycle', zone.cycle);
    SystemVars.Write('SelectedZoneMachineDuration', zone.machineDuration);
    SystemVars.Write('SelectedZoneName', zone.name);
    SystemVars.Write('SelectedZoneNumberOfCycles', zone.noOfCycles);
    SystemVars.Write('SelectedZoneRemaining', zone.remaining);
    SystemVars.Write('SelectedZoneRestriction', zone.restriction);
    SystemVars.Write('SelectedZoneState', zone.state);
    SystemVars.Write('SelectedZoneUserDuration', zone.userDuration);
}

function StartProgram(program: number) {
    logger.logTrace('StartProgram, program: [' + program + ']');

    device.StartProgram(program);
}

function StartSelectedProgram() {
    logger.logTrace('StartSelectedProgram');

    StartProgram(selectedProgramIndex + 1);
}

function StartSelectedZone(duration: number) {
    logger.logTrace('StartSelectedZone, duration: [' + duration + ']');

    StartZone(selectedZoneIndex + 1, duration);
}

function StartZone(zone: number, duration: number) {
    logger.logTrace('StartZone, zone: [' + zone + '], duration: [' + duration + ']');

    device.StartZone(zone, duration);
}

function StopProgram(program: number) {
    logger.logTrace('StopProgram, program: [' + program + ']');

    device.StopProgram(program);
}

function StopSelectedProgram() {
    logger.logTrace('StopSelectedProgram');

    StopProgram(selectedProgramIndex + 1);
}

function StopSelectedZone() {
    logger.logTrace('StopSelectedZone');

    StopZone(selectedZoneIndex + 1);
}

function StopZone(zone: number) {
    logger.logTrace('StopZone, zone: [' + zone +']');

    device.StopZone(zone);
}

Init();