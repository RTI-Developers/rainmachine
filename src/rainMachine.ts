namespace RainMachine {

    export class Device {
        private readonly ACCESS_TOKEN_PLACEHOLDER: string = '{{access_token}}';

        private readonly authRequest: Request | null;
        private readonly host: string = '';
        private readonly http: HTTP | null;
        private readonly logger: Logger | null;
        private readonly loggerContext: string = '';
        private readonly model: Model | null = null;
        private readonly onStateChanged: () => void;
        private readonly password: string = '';
        private readonly pollingTimer: ScheduledEvent | null = null;
        private readonly port: number | null;
        private readonly requestQueue: Request[] = [];

        private activeRequest: Request | null = null;
        private accessToken: string = '';

        public ApiVersion: string = '';
        public HardwareVersion: string = '';
        public Programs: Program[] = [];
        public MasterZone: Zone | null = null;
        public Restrictions: CurrentRestrictions | null = null;
        public SoftwareVersion: string = '';
        public Zones: Zone[] = [];

        constructor(
            model: Model,
            host: string,
            port: number,
            password: string,
            pollingInterval: number,
            logger: Logger,
            onCommRx: (data: string) => void,
            onConnect: () => void,
            onConnectFailure: () => void,
            onDisconnect: () => void,
            onPollingTimer: () => void,
            onSslHandshake: () => void,
            onSslHandshakeFailure: () => void,
            onStateChanged: () => void,
        ) {
            this.model = model;
            this.host = host;
            this.port = port;
            this.password = password;
            this.logger = logger;
            this.onStateChanged = onStateChanged;

            this.loggerContext = "RainMachine.Device [" + host + ":" + port + "]";

            this.authRequest = this.CreateHttpRequest(
                RequestType.Auth,
                'auth/login',
                undefined,
                JSON.stringify({
                    "pwd": this.password,
                    "remember": 1
                })
            );

            this.http = new HTTP(onCommRx);
            this.http.OnConnectFunc = onConnect;
            this.http.OnConnectFailedFunc = onConnectFailure;
            this.http.OnDisconnectFunc = onDisconnect;
            this.http.OnSSLHandshakeOKFunc = onSslHandshake;
            this.http.OnSSLHandshakeFailedFunc = onSslHandshakeFailure;

            if (pollingInterval > 0) {
                this.logger!.logTrace('Initializing Polling ScheduledEvent with pollingInterval: [' + pollingInterval + '] seconds', this.loggerContext);
                this.pollingTimer = new ScheduledEvent(onPollingTimer, "Periodic", "Seconds", pollingInterval);
                this.pollingTimer.Enable();
                this.Refresh();
            }
            else {
                this.SendVersionsRequest();
            }
        }

        private CreateHttpRequest(requestType: RequestType, urlPath: string, urlParams?: { [key: string]: string }, body?: string): Request {
            this.logger!.logTrace('CreateHttpRequest, requestType: [' + requestType + '], urlPath: [' + urlPath + '], urlParams: [' + JSON.stringify(urlParams) + '], body: [' + body + ']', this.loggerContext);

            let verb: ('GET' | 'POST') = 'GET';

            switch (requestType) {
                case RequestType.Auth:
                case RequestType.ProgramStart:
                case RequestType.ProgramStop:
                case RequestType.ZoneStart:
                case RequestType.ZoneStop:
                    verb = 'POST';
                    break;
                default:
                    break;
            }

            let requestData = verb + ' https://' + this.host + ':' + this.port + '/api/4/' + urlPath;

            if (urlParams) {
                requestData += '?x=x';
                for (let key in urlParams) {
                    let value = urlParams[key];
                    requestData += '&' + key + '=' + value;
                }
            }

            requestData += ' HTTP/1.1' + '\r\n';
            if (requestType !== RequestType.Auth) {
                requestData += 'Cookie: access_token=' + this.ACCESS_TOKEN_PLACEHOLDER + '\r\n'; // Use access token placeholder as access_token may change after command is queued
            }
            requestData += 'Host: ' + this.host + ':' + this.port!.toString() + '\r\n';

            if (verb == 'POST') {
                requestData += 'Content-type: application/json' + '\r\n';
                requestData += 'Content-length: ' + (body?.length ?? 0) + '\r\n\r\n';
                requestData += body;
            } else {
                requestData += '\r\n';
            }

            this.logger!.logTrace(requestData, this.loggerContext, true);

            return {
                data: requestData,
                type: requestType
            };
        }

        private GetResponseBody(data: string) {
            this.logger!.logTrace('GetResponseBody', this.loggerContext);

            const bodySeparator = '\r\n\r\n';
            const bodyIndex = data.indexOf(bodySeparator);

            if (bodyIndex >= 0) {
                return data.substring(bodyIndex + bodySeparator.length);
            }

            return null;
        }

        private OpenConnection() {
            this.http!.Open(this.host, this.port!);
            this.http!.AddRxHTTPFraming();
        }

        private ProcessQueue() {
            this.logger!.logTrace('ProcessQueue', this.loggerContext);

            this.http!.Close();

            if (this.requestQueue.length > 0) {
                this.OpenConnection();
            }
        }

        public OnCommRx(data: string) {
            this.logger!.logTrace('OnCommRx', this.loggerContext);

            const activeRequest = this.activeRequest;
            this.activeRequest = null;

            if (!activeRequest) {
                this.logger!.logError('Received response without a corresponding active request, data: [' + data + ']', this.loggerContext);
                this.ProcessQueue();
                return;
            }

            if (data.indexOf('HTTP/1.1 200') < 0 && activeRequest.type == RequestType.Auth) {
                this.logger!.logError('Authentication Failed!', this.loggerContext);
                this.requestQueue.splice(0);  // Clear queue
                this.ProcessQueue();
                return;
            }

            if (data.indexOf('HTTP/1.1 401') >= 0) {
                this.logger!.logTrace('Received unauthorized response, requeuing active request and auth request', this.loggerContext);
                this.requestQueue.unshift(activeRequest);
                this.requestQueue.unshift(this.authRequest!);
                this.ProcessQueue();
                return;
            }

            const responseBody = this.GetResponseBody(data);

            this.logger!.logTrace('Handling response for activeRequest type: [' + RequestType[activeRequest.type!] + ']', this.loggerContext);

            if (responseBody) {
                switch (activeRequest.type) {
                    case RequestType.Auth:
                        this.accessToken = (JSON.parse(responseBody) as AuthResponse).access_token

                        if (this.accessToken.length <= 0) {
                            this.logger!.logTrace('AuthResponse missing access_token');
                            this.requestQueue.splice(0);  // Clear queue
                        }
                        break;
                    case RequestType.Programs:
                        const programsResponse = (JSON.parse(responseBody) as ProgramCollection);
                        this.Programs = programsResponse.programs;
                        this.onStateChanged();
                        break;
                    case RequestType.ProgramStart:
                        if (data.indexOf('HTTP/1.1 200') < 0) {
                            this.logger!.logError('Program Start Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.SendProgramsRequest();
                        break;
                    case RequestType.ProgramStop:
                        if (data.indexOf('HTTP/1.1 200') < 0) {
                            this.logger!.logError('Program Stop Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.SendProgramsRequest();
                        break;
                    case RequestType.Restrictions:
                        const restrictionsResponse = (JSON.parse(responseBody) as CurrentRestrictions);
                        this.Restrictions = restrictionsResponse;
                        this.onStateChanged();
                        break;
                    case RequestType.Version:
                        const versionResponse = (JSON.parse(responseBody) as Version);
                        this.ApiVersion = versionResponse.apiVer;
                        this.HardwareVersion = versionResponse.hwVer;
                        this.SoftwareVersion = versionResponse.swVer;
                        this.onStateChanged();
                        break;
                    case RequestType.Zones:
                        const zonesResponse = (JSON.parse(responseBody) as ZoneCollection);
                        this.Zones = zonesResponse.zones;
                        if (this.model == 'pro') {  // Handle 'master' zone on Pro models
                            this.MasterZone = this.Zones[0];
                            this.Zones = this.Zones.slice(1);
                        }
                        this.onStateChanged();
                        break;
                    case RequestType.ZoneStart:
                        if (data.indexOf('HTTP/1.1 200') < 0) {
                            this.logger!.logError('Zone Start Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.SendZonesRequest();
                        break;
                    case RequestType.ZoneStop:
                        if (data.indexOf('HTTP/1.1 200') < 0) {
                            this.logger!.logError('Zone Stop Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.SendZonesRequest();
                        break;
                    default:
                        break;
                }
            }

            this.ProcessQueue();
        }

        public OnConnect() {
            this.logger!.logTrace('OnConnect', this.loggerContext);

            this.http!.StartSSLHandshake();
        }

        public OnConnectFailure() {
            this.logger!.logTrace('OnConnectionFailure', this.loggerContext);

            this.ProcessQueue();
        }

        public OnDisconnect() {
            this.logger!.logTrace('OnDisconnect', this.loggerContext);

            this.ProcessQueue();
        }

        public OnPollingTimer() {
            this.logger!.logTrace('OnPollingTimer', this.loggerContext);

            this.Refresh();
        }

        public OnSslHandshakeFailure() {
            this.logger!.logError('SSL Handshake Failed.');
        }

        public OnSslHandshake() {
            this.logger!.logTrace('OnSslHandshake', this.loggerContext);

            this.activeRequest = this.requestQueue.shift() ?? null;

            if (this.activeRequest) {
                const payload = this.activeRequest!.data.replace(this.ACCESS_TOKEN_PLACEHOLDER, this.accessToken); // Replace access token placeholder as access_token may change after command is queued
                this.logger!.logTrace('Writing activeRequest, type: [' + this.activeRequest.type + '], payload: [' + payload + ']', this.loggerContext);

                this.http!.Write(payload);
            } else {
                this.logger!.logTrace('No activeRequest, disconnecting', this.loggerContext);

                this.http!.Close();
            }
        }

        public Refresh() {
            this.SendProgramsRequest();
            this.SendZonesRequest();
            this.SendRestrictionsRequest();
            this.SendVersionsRequest();
        }

        public SendProgramsRequest() {
            this.logger!.logTrace('SendProgramsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Programs, 'program'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public SendRestrictionsRequest() {
            this.logger!.logTrace('SendRestrictionsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Restrictions, 'restrictions/currently'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public SendVersionsRequest() {
            this.logger!.logTrace('SendVersionsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Version, 'apiVer'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public SendZonesRequest() {
            this.logger!.logTrace('SendZonesRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Zones, 'zone'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public StartProgram(program: number) {
            this.logger!.logTrace('StartProgram, program: [' + program + ']', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ProgramStart, 'program/' + program + '/start'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public StopProgram(program: number) {
            this.logger!.logTrace('StopProgram, program: [' + program + ']', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ProgramStop, 'program/' + program + '/stop'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public StartZone(zone: number, duration: number) {
            this.logger!.logTrace('SendZoneStartRequest, zone: [' + zone + '], duration: [' + duration + ']', this.loggerContext);

            if (this.model == 'pro') { zone++; } // Account for 'master' zone

            this.requestQueue.push(
                this.CreateHttpRequest(
                    RequestType.ZoneStart,
                    'zone/' + zone + '/start',
                    undefined,
                    JSON.stringify({ time: duration })
                ));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }

        public StopZone(zone: number) {
            this.logger!.logTrace('StopZone, zone: [' + zone + ']', this.loggerContext);

            if (this.model == 'pro') { zone++; } // Account for 'master' zone

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ZoneStop, 'zone/' + zone + '/stop'));
            if (this.http!.OpenState === 0) { this.OpenConnection(); }
        }
    }

    class Request {
        data: string = '';
        type: RequestType | null = null;
    }

    export type Model = ('mini8' | 'pro' | 'touchhd');

    export enum RequestType {
        Auth,
        Programs,
        ProgramStart,
        ProgramStop,
        Restrictions,
        Version,
        Zones,
        ZoneStart,
        ZoneStop
    }

    export enum StatusCode {
        Success = 0,
        ExceptionOccurred = 1,
        NotAuthenticated = 2,
        InvalidRequest = 3,
        NotImplemented = 4,
        NotFound = 5,
        DBError = 6,
        ProvisionFailed = 7,
        PasswordNotChanged = 8,
        ProgramValidationFailed = 9
    }

    export enum ProgramStatus {
        NotRunning = 0,
        Running = 1,
        Queued = 2
    }

    export enum ZoneState {
        NotRunning = 0,
        Running = 1,
        Queued = 2
    }

    export enum VegetationType {
        NotSet = 0,
        NotSetOld = 1,
        Grass = 2,
        FruitTrees = 3,
        Flowers = 4,
        Vegetables = 5,
        Citrus = 6,
        Bushes = 7,
        Xeriscape = 9,
        Other = 99
    }

    export enum SoilType {
        NotSet = 0,
        ClayLoam = 1,
        SiltyClay = 2,
        Clay = 3,
        Loam = 4,
        SandyLoam = 5,
        LoamySand = 6,
        Sand = 7,
        SandyClay = 8,
        SiltLoam = 9,
        Silt = 10,
        Other = 99
    }

    export enum SprinklerType {
        NotSet = 0,
        PopupSpray = 1,
        Rotors = 2,
        SurfaceDrip = 3,
        Bubblers = 4,
        RotorsHigh = 5,
        Other = 99
    }

    export enum SlopeType {
        NotSet = 0,
        Flat = 1,
        Moderate = 2,
        High = 3,
        VeryHigh = 4,
        Other = 99
    }

    export enum SunExposure {
        NotSet = 0,
        FullSun = 1,
        PartialShade = 2,
        FullShade = 3
    }

    export enum WateringFlag {
        NormalWatering = 0,
        InterruptedByUser = 1,
        RestrictionThreshold = 2,
        RestrictionFreezeProtect = 3,
        RestrictionDay = 4,
        RestrictionOutOfDay = 5,
        WaterSurplus = 6,
        StoppedByRainSensor = 7,
        SoftwareRainSensorRestriction = 8,
        MonthRestricted = 9,
        RainDelaySetByUser = 10,
        ProgramRainRestriction = 11
    }

    export enum FrequencyType {
        Daily = 0,
        EveryNDays = 1,
        Weekday = 2,
        OddEvenDay = 4
    }

    export enum StartTimeType {
        NormalStartTime = 0,
        Sunrise = 1,
        Sunset = 2
    }

    export enum UpdateState {
        Idle = 1,
        Checking = 2,
        Downloading = 3,
        Upgrading = 4,
        Error = 5,
        Reboot = 6
    }
}
