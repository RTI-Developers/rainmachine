namespace RainMachine {

    export class Device {
        private readonly ACCESS_TOKEN_PLACEHOLDER: string = '{{access_token}}';

        private readonly authRequest: Request | null;
        private readonly host: string = '';
        private readonly http: HTTP | null;
        private readonly logger: Logger | null;
        private readonly loggerContext: string = '';
        private readonly model: Model | null = null;
        private readonly onPollingTimer: () => void;
        private readonly onStateChanged: () => void;
        private readonly password: string = '';
        private readonly pollingInterval: number = 0;
        private readonly pollingTimer: Timer | null;
        private readonly port: number | null;
        private readonly requestQueue: Request[] = [];
        
        private activeRequest: Request | null = null;
        private accessToken: string = '';

        public ApiVersion: string = '';
        public HardwareVersion: string = '';
        public Programs: Program[] = [];
        public MasterZone: Zone | null;
        public Restrictions: CurrentRestrictions | null;
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
            this.pollingInterval = pollingInterval;
            this.logger = logger;
            this.onPollingTimer = onPollingTimer;
            this.onStateChanged = onStateChanged;

            this.authRequest = this.CreateHttpRequest(
                RequestType.Auth,
                'auth/login',
                undefined,
                JSON.stringify({
                    "pwd": this.password,
                    "remember": 1
                })
            );

            this.loggerContext = "RainMachine.Device [" + host + ":" + port + "]";

            this.http = new HTTP(onCommRx, host, port);
            this.http.OnConnectFunc = onConnect;
            this.http.OnConnectFailedFunc = onConnectFailure;
            this.http.OnDisconnectFunc = onDisconnect;
            this.http.OnSSLHandshakeOKFunc = onSslHandshake;
            this.http.OnSSLHandshakeFailedFunc = onSslHandshakeFailure;

            if (pollingInterval > 0) {
                this.pollingTimer = new Timer();
                this.pollingTimer.Start(onPollingTimer, pollingInterval);
                this.Refresh();
            }
            else {
                this.SendVersionsRequest();
            }
        }

        private CreateHttpRequest(requestType: RequestType, urlPath: string, urlParams?: { [key: string]: string }, body?: string): Request {
            this.logger!.logTrace('CreateHttpRequest, requestType: [' + requestType + '], urlPath: [' + urlPath +'], urlParams: [' + JSON.stringify(urlParams) + '], body: [' + body + ']', this.loggerContext);
            
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
                    requestData + '&' + key + '=' + value;
                }
            }

            requestData += ' HTTP/1.1' + '\r\n';
            if (requestType !== RequestType.Auth) {
                requestData += 'Cookie: access_token=' + this.ACCESS_TOKEN_PLACEHOLDER + '\r\n'; // Use access token placeholder as access_token may change after command is queued
            }
            requestData += 'Host: ' + this.host + ':' + this.port!.toString();
        
            if (verb == 'POST') {
                requestData += 'Content-type: application/json' + '\r\n';
                requestData += 'Content-length: ' + (body?.length ?? 0) + '\r\n\r\n';
                requestData += body;
            } else {
                requestData += '\r\n\r\n';
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
                return data.substr(bodyIndex + bodySeparator.length);
            }

            return null;
        }
        
        private SendNextRequest() {
            this.logger!.logTrace('SendNextRequest', this.loggerContext);

            this.http!.Close();

            if (this.requestQueue.length > 0) {
                this.http!.Open(this.host, this.port!.toString());
            }
        }

        public OnCommRx(data: string) {
            this.logger!.logTrace('OnCommRx', this.loggerContext);

            this.http!.Disconnect();

            const activeRequest = this.activeRequest;
            this.activeRequest = null;

            if (!activeRequest) {
                this.logger!.logError('Received response without a corresponding active request, data: [' + data + ']', this.loggerContext);
                return;
            }

            if (data.indexOf('HTTP/1.1 200') < 0 && activeRequest.type == RequestType.Auth) {
                this.logger!.logError('Authentication Failed!', this.loggerContext);
                this.requestQueue.length = 0;  // Clear queue
                return;
            }

            if (data.indexOf('HTTP/1.1 401') >= 0) {
                this.logger!.logTrace('Received unauthorized response, requeuing active request and auth request', this.loggerContext);
                this.requestQueue.unshift(activeRequest);
                this.requestQueue.unshift(this.authRequest!);
                return;
            }

            const responseBody = this.GetResponseBody(data);

            this.logger!.logTrace('Handling response for activeRequest type: [' + RequestType[activeRequest.type] + ']', this.loggerContext);

            if (responseBody) {
                switch (activeRequest.type) {
                    case RequestType.Auth:
                        this.accessToken = (JSON.parse(responseBody) as AuthResponse).access_token

                        if (this.accessToken.length <= 0) {
                            this.logger!.logTrace('AuthResponse missing access_token');
                            this.requestQueue.length = 0;  // Clear queue
                        }
                        break;
                    case RequestType.Programs:
                        const programsResponse = (JSON.parse(responseBody) as ProgramCollection);
                        this.Programs = programsResponse.programs;
                        this.onStateChanged();
                        break;
                    case RequestType.ProgramStart:
                        if (data.indexOf('200') < 0) {
                            this.logger!.logError('Program Start Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.QueueProgramsRequest();
                        break;
                    case RequestType.ProgramStop:
                        if (data.indexOf('200') < 0) {
                            this.logger!.logError('Program Stop Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.QueueProgramsRequest();
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
                        if (data.indexOf('200') < 0) {
                            this.logger!.logError('Zone Start Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.QueueZonesRequest();
                        break;
                    case RequestType.ZoneStop:
                        if (data.indexOf('200') < 0) {
                            this.logger!.logError('Zone Stop Failed. data: [' + data + ']', this.loggerContext);
                            break;
                        }
                        this.QueueZonesRequest();
                        break;
                    default:
                        break;
                }
            }
        }

        private QueueProgramsRequest() {
            this.logger!.logTrace('QueueProgramsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Programs, 'program'));
        }

        private QueueRestrictionsRequest() {
            this.logger!.logTrace('QueueRestrictionsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Restrictions, 'restrictions/currently'));
        }

        private QueueZonesRequest() {
            this.logger!.logTrace('QueueRestrictionsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Zones, 'zone'));
        }

        public OnConnect() {
            this.logger!.logTrace('OnConnect', this.loggerContext);

            this.http!.StartSSLHandshake();
        }

        public OnConnectFailure() {
            this.logger!.logTrace('OnConnectionFailure', this.loggerContext);

            this.http!.Close();
        }

        public OnDisconnect() {
            this.logger!.logTrace('OnDisconnect', this.loggerContext);

            this.SendNextRequest();
        }

        public OnPollingTimer() {
            this.logger!.logTrace('OnPollingTimer', this.loggerContext);

            this.Refresh();
            this.pollingTimer!.Start(this.onPollingTimer, this.pollingInterval);
        }

        public OnSslHandshakeFailure() {
            this.logger!.logError('SSL Handshake Failed.');
        }

        public OnSslHandshake() {
            this.logger!.logTrace('OnSslHandshakeSuccess', this.loggerContext);

            this.activeRequest = this.requestQueue.shift() ?? null;

            if (this.activeRequest) {
                const payload = this.activeRequest!.data.replace(this.ACCESS_TOKEN_PLACEHOLDER, this.accessToken); // Replace access token placeholder as access_token may change after command is queued
                this.logger!.logTrace('Writing activeRequest, type: [' + this.activeRequest.type + '], payload: [' + payload + ']', this.loggerContext);
                
                this.http!.AddRxHTTPFraming();
                this.http!.Write(payload);  
            } else {
                this.logger!.logTrace('No activeRequest, disconnecting', this.loggerContext);

                this.http!.Disconnect();
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

            this.QueueProgramsRequest();
            this.SendNextRequest();
        }

        public SendRestrictionsRequest() {
            this.logger!.logTrace('SendRestrictionsRequest', this.loggerContext);

            this.QueueRestrictionsRequest();
            this.SendNextRequest();
        }

        public SendVersionsRequest() {
            this.logger!.logTrace('SendVersionsRequest', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.Version, 'apiVer'));
            this.SendNextRequest();
        }
        
        public SendZonesRequest() {
            this.logger!.logTrace('SendZonesRequest', this.loggerContext);

            this.QueueZonesRequest();
            this.SendNextRequest();
        }

        public StartProgram(program: number) {
            this.logger!.logTrace('StartProgram, program: [' + program + ']', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ProgramStart, 'program/' + program +'/start'));
            this.SendNextRequest();
        }

        public StopProgram(program: number) {
            this.logger!.logTrace('StopProgram, program: [' + program + ']', this.loggerContext);

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ProgramStop, 'program/' + program +'/stop'));
            this.SendNextRequest();
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
            this.SendNextRequest();
        }
        
        public StopZone(zone: number) {
            this.logger!.logTrace('StopZone, zone: [' + zone + ']', this.loggerContext);

            if (this.model == 'pro') { zone++; } // Account for 'master' zone

            this.requestQueue.push(this.CreateHttpRequest(RequestType.ZoneStop, 'zone/' + zone +'/stop'));
            this.SendNextRequest();
        }
    }

    class Request {
        data: string;
        type: RequestType;
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

// let StatusCodeMessages: { [key in RainMachine.StatusCode]: string } = {
//     [RainMachine.StatusCode.Success]: "OK",
//     [RainMachine.StatusCode.ExceptionOccurred]: "Exception occurred !",
//     [RainMachine.StatusCode.NotAuthenticated]: "Not Authenticated !",
//     [RainMachine.StatusCode.InvalidRequest]: "Invalid request !",
//     [RainMachine.StatusCode.NotImplemented]: "Not implemented yet !",
//     [RainMachine.StatusCode.NotFound]: "Not found !",
//     [RainMachine.StatusCode.DBError]: "DB StatusCode !",
//     [RainMachine.StatusCode.ProvisionFailed]: "Cannot provision unit",
//     [RainMachine.StatusCode.PasswordNotChanged]: "Cannot change password",
//     [RainMachine.StatusCode.ProgramValidationFailed]: "Invalid program constraints"
// };

