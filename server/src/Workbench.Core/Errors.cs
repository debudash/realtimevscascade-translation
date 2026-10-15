namespace Workbench.Core;

/// <summary>The typed error taxonomy (CLAUDE.md, Resilience).</summary>
public static class ErrorCodes
{
    public const string MicDenied = "mic_denied";
    public const string SocketDrop = "socket_drop";
    public const string ProviderTimeout = "provider_timeout";
    public const string RateLimited = "rate_limited";
    public const string EmptyResult = "empty_result";
    public const string ConfigError = "config_error";
    public const string ProviderError = "provider_error";
    public const string Internal = "internal";
}

/// <summary>Base for failures a provider adapter reports. The pipeline maps these to ErrorEvents.</summary>
public abstract class ProviderException(string provider, string stage, string message, Exception? inner = null)
    : Exception(message, inner)
{
    public string Provider { get; } = provider;
    public string Stage { get; } = stage;
    public abstract string Code { get; }
    public virtual bool Retryable => true;
}

/// <summary>No first token / byte / final within the stage timeout.</summary>
public sealed class ProviderTimeoutException(string provider, string stage, string message)
    : ProviderException(provider, stage, message)
{
    public override string Code => ErrorCodes.ProviderTimeout;
}

/// <summary>HTTP 429 (or the provider's equivalent quota signal).</summary>
public sealed class RateLimitedException(string provider, string stage, string message)
    : ProviderException(provider, stage, message)
{
    public override string Code => ErrorCodes.RateLimited;
}

/// <summary>Any other provider failure. HttpStatus is set when there was one.</summary>
public sealed class ProviderErrorException(string provider, string stage, string message, int? httpStatus = null, Exception? inner = null)
    : ProviderException(provider, stage, message, inner)
{
    public int? HttpStatus { get; } = httpStatus;
    public override string Code => ErrorCodes.ProviderError;
    /// <summary>Transient: no status (network), 408 Request Timeout, 425 Too Early, or 5xx.</summary>
    public override bool Retryable => HttpStatus is null or 408 or 425 or >= 500;
}

/// <summary>A required key is missing. Never carries the key value, only its variable name.</summary>
public sealed class ProviderConfigException(string provider, string stage, string variableName)
    : ProviderException(provider, stage, $"Missing configuration: {variableName}")
{
    public string VariableName { get; } = variableName;
    public override string Code => ErrorCodes.ConfigError;
    public override bool Retryable => false;
}
