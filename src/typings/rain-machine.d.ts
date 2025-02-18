declare namespace RainMachine {

  interface AuthResponse {
    access_token: string,
    checksum: string,
    expires_in: number,
    expiration: string,
    statusCode: number
}

  interface DailyStats {
    id: number; // Day offset relative to today which is 0.
    day: Date; // Day in YYYY-MM-DD format
    mint: number; // Minimum temperature of the day
    maxt: number; // Maximum temperature of the day
    icon: number; // Weather icon for that day
    percentage: number; // How much it actually waters
    wateringFlag: WateringFlag;
    vibration: number[]; // How the watering percetage varies with historical and future weather predictions
    simulatedPercentage: number; // How much it would water if a daily program would be configured
    simulatedVibration: number[]; // How the watering percetage would vary if a daily program would be configured
  }

  interface DailyStats {
    DailyStats: DailyStats[];
  }

  interface DailyStatDetailProgram {
    id: number;
    zones: DailyStatDetailProgramZone[];
  }

  interface DailyStatDetailProgramZone {
    id: number;
    scheduledWateringTime: number; // User specified watering time for this zone
    computedWateringTime: number; // Calculated watering time for this zone
    availableWater: number; // Available water for this zone
    coefficient: number; // Zone watering coefficient
    percentage: 0;
  }

  interface DailyStatDetail {
    dayTimestamp: number;
    day: Date;
    mint: number;
    maxt: number;
    icon: number;
    programs: DailyStatDetailProgram[];
    simulatedPrograms: DailyStatDetailProgram[];
  }

  interface ProgramFrequency {
    type: FrequencyType;
    param: string; // Odd days: 1, Even days: 0, EveryNFormat: days, Weekday: SSFTWTM0
  }

  interface WateringTime {
    id: number;
    order: number;
    name: string;
    duration: number;
    active: boolean;
    userPercentage: number;
    minRuntimeCoef: number;
  }

  interface StartTimeParams {
    offsetSign: number; // -1 offsetMinutes are before selected type, 1 means after
    type: StartTimeType;
    offsetMinutes: number; // Minutes after/before sunrise/sunset
  }

  interface Program {
    uid: number; // Program unique ID. Automatically generated when a new program is created
    name: string; // Program Name
    active: boolean; // If program is not active it won't be started
    startTime: string; // Program start time in HH:MM format
    cycles: number; // The number of cycles that the duration of each zone will be split into
    soak: number; // How many seconds to wait before starting next cycle for same zone
    cs_on: boolean; // If cycle and soak settings are enabled or not for this program
    delay: number; // The delay between starting next zone (to build water pressure)
    delay_on: boolean; // If the delay between zones is enabled or not
    status: ProgramStatus;
    startTimeParams: StartTimeParams; // Used to set program start time at sunrise/sunset. Start hour, minute is automatically computed every time the program starts
    frequency: ProgramFrequency;
    coef: number; // Unused
    ignoreInternetWeather: boolean; // If program should ignore all weather data
    futureField1: number; // Hold the forecasted rain amount which will restrict program watering (this overwrites RainMachine algorithm decision)
    freq_modified: number; // Used to hold the percentage (0-100) that will trigger a watering skip, when the watering percentage is below this number
    useWaterSense: boolean; // WaterSense algorithm that automatically determines the time to be watered for each zone
    nextRun?: string; // Next scheduled run in YYYY-MM-DD format
    startDate?: string; // Start date of a program. The format is YYYY-MM-DD
    endDate?: string; // End date of a program run. The format is YYYY-MM-DD. This is uses to have programs valid in certain months, for example programs that run from May till August.
    yearlyRecurring: boolean; // Specifies if the program should repeat or not in the next years
    simulationExpired: boolean; // True if simulation data for that program has expired and a new one is being run
    wateringTimes: WateringTime[]; // List of zones and their watering times for this program
  }

  interface ProgramCollection {
    programs: Program[];
  }

  interface WaterSense {
    fieldCapacity: number; // Decimal percentage that is used when defining a custom Soil type which is the amount of water remaining in the soil a few days after having been wetted and after free drainage has ceased
    rootDepth: number; // Average Root depth of the plants in the zone (mm)
    appEfficiency: number; // Sprinkler head application efficiency (percent)
    isTallPlant: boolean; // True/False if plant is above 20cm
    permWilting: number; // Permanent wilting point (percent of the plant root depth)
    allowedSurfaceAcc: number; // Soil allowed surface accumulation (mm)
    maxAllowedDepletion: number; // The maximum allowed depletion
    precipitationRate: number; // Sprinkler head precipiration rate (mm/h)
    currentFieldCapacity: number; // Current field capacity a read-only value that is computed by rainmachine from the sun, slope, soil and vegetation types parameters. This represent how much water in mm the zone can hold
    area: number; // The zone area in square meters
    referenceTime: number; // EPA Watersense suggested daily summer day watering time in seconds. This value is read-only and it's computed by RainMachine based on other zone parameters
    detailedMonthsKc: string[]; // String with format [0.4, 0.3,....12th Value] expressing the crop coeficient for each year month
    flowrate: number; // The zone flow debit in cubic meters per hour
    soilIntakeRate: number; // Soil intake rate (mm/h)
  }

  interface CurrentRestrictions {
    hourly: boolean;
    freeze: boolean;
    month: boolean;
    weekDay: boolean;
    rainDelay: boolean;
    rainDelayCounter: number;
    rainSensor: boolean;
    lastLeakDetected: number;
  }

  interface GlobalRestrictions {
    hotDaysExtraWatering: boolean;
    freezeProtectEnabled: boolean;
    freezeProtectTemp: number;
    noWaterInWeekDays: string;
    noWaterInMonths: string;
    rainDelayStartTime: number;
    rainDelayDuration: number;
  }

  interface Zone {
    uid: number;
    name: string;
    state: ZoneState;
    active: boolean,
    userDuration: number;
    machineDuration: number;
    remaining: number;
    cycle: number;
    noOfCycles: number;
    restriction: boolean;
    type: VegetationType,
    master: boolean,
  }

  interface ZoneCollection {
    zones: Zone[];
  }

  interface ZoneDetail {
    uid: number;
    name: string;
    valveid: number;
    ETcoef: number;
    active: boolean;
    type: VegetationType;
    internet: boolean;
    savings: number;
    slope: SlopeType;
    sun: SunExposure;
    soil: SoilType;
    group_id: SprinklerType;
    history: boolean;
    master: boolean;
    before: number;
    after: number;
    waterSense: WaterSense;
  }

  interface ZoneDetails {
    zones: ZoneDetail[];
  }

  interface Version {
    apiVer: string;
    hwVer: string;
    swVer: string;
  }

  interface MachineTime {
    timestamp: number; // 1495618396
    appDate: Date; // YYY-MM-DD HH:MM:SS
    timezone: string; // America/Los_Angeles
  }

  interface UpdateStatus {
    lastUpdateCheckTimestamp: number;
    packageDetails: [];
    update: boolean;
    lastUpdateCheck: Date; // YYY-MM-DD HH:MM:SS
    updateStatus: UpdateState;
  }
}
