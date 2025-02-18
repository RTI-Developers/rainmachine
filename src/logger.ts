class Logger {
    private readonly _enableTrace: boolean;
    private readonly _prefix: string;

    constructor(prefix: string, enableTrace: boolean) {
        this._enableTrace = enableTrace;
        this._prefix = prefix;
    }

    logError(message: string, context?: string) {
        this.logInternal("Error", message, context);
    }

    logInfo(message: string, context?: string) {
        this.logInternal("Info", message, context);
    }

    logTrace(message: string, context?: string, useMultiline: boolean = false) {
        if (this._enableTrace) {
            this.logInternal("Trace", message, context, useMultiline);
        }
    }

    private logInternal(messageType: string, message: string, context?: string, useMultiline: boolean = false) {
        let prefix = this._prefix + " [" + messageType + "] - ";
        if (context) {
            prefix += "Context: [" + context + "] - ";
        }

        if (useMultiline) {
            System.Print(prefix);
            System.PrintMultiline(message);
        } else {
            System.Print(prefix + message);
        }
    }
}