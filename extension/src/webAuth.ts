import { createClient, type User } from "@supabase/supabase-js";
import type {
  AuthDiagnosticCode,
  AuthFailure,
  AuthRuntimeRequest,
  AuthRuntimeResponse,
  AuthStatus,
  RecoveryCredentials,
  SafeAuthMutation,
  SafeAuthUser,
} from "./backgroundAuth";

const PASSWORD_RECOVERY_MARKER_TTL_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_MARGIN_SECONDS = 60;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

let client: ReturnType<typeof createClient> | null | undefined;

function getWebClient(): ReturnType<typeof createClient> | null {
  if (client !== undefined) return client;
  client =
    supabaseUrl && supabasePublishableKey
      ? createClient(supabaseUrl, supabasePublishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: "pkce",
          },
        })
      : null;
  return client;
}

let recoverySession: { userId: string; expiresAt: number } | null = null;

function safeUser(user: User | null | undefined): SafeAuthUser | undefined {
  if (!user) return undefined;
  const providers = user.app_metadata?.providers;
  const hasProviderMetadata =
    Array.isArray(providers) || Array.isArray(user.identities);
  const hasPassword =
    (Array.isArray(providers) && providers.includes("email")) ||
    user.identities?.some((identity) => identity.provider === "email") === true;
  return {
    id: user.id,
    email: user.email ?? null,
    ...(hasProviderMetadata ? { hasPassword } : {}),
  };
}

function diagnosticCode(error: unknown): AuthDiagnosticCode {
  if (typeof error !== "object" || error === null) return "AUTH_UNKNOWN";
  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (status === 429) return "AUTH_RATE_LIMITED";
  if (status !== undefined && status >= 500) return "AUTH_SERVER_ERROR";
  if (status === 400 && /invalid login credentials|invalid credentials/.test(message)) {
    return "AUTH_INVALID_CREDENTIALS";
  }
  if (/already registered|already been registered/.test(message)) {
    return "AUTH_EMAIL_REGISTERED";
  }
  if (
    "name" in error &&
    (error.name === "AuthRetryableFetchError" || error.name === "TypeError")
  ) {
    return "AUTH_NETWORK_ERROR";
  }
  return "AUTH_UNKNOWN";
}

function authFailure(
  message: string,
  error?: unknown,
  code: AuthFailure["code"] = "AUTH_REQUEST_FAILED",
): AuthFailure {
  const httpStatus =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  return {
    code,
    message,
    diagnosticCode: diagnosticCode(error),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

function failureResponse(
  request: AuthRuntimeRequest,
  error: AuthFailure,
): AuthRuntimeResponse {
  const result = { success: false as const, error };
  switch (request.type) {
    case "AUTH_GET_STATUS":
      return { type: request.type, result };
    case "AUTH_SIGN_UP":
      return { type: request.type, result };
    case "AUTH_SIGN_IN":
      return { type: request.type, result };
    case "AUTH_SIGN_IN_WITH_GOOGLE":
      return { type: request.type, result };
    case "AUTH_SEND_PASSWORD_RECOVERY":
      return { type: request.type, result };
    case "AUTH_VERIFY_PASSWORD_RECOVERY":
      return { type: request.type, result };
    case "AUTH_CHANGE_PASSWORD":
      return { type: request.type, result };
    case "AUTH_RESET_PASSWORD":
      return { type: request.type, result };
    case "AUTH_SIGN_OUT":
      return { type: request.type, result };
  }
}

async function recoveryUserId(
  credentials: RecoveryCredentials,
): Promise<string | null> {
  const client = getWebClient();
  if (!client) return null;
  if ("accessToken" in credentials) {
    const { data, error } = await client.auth.setSession({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
    });
    if (!error) return data.user?.id ?? null;
  } else if ("code" in credentials) {
    const { data, error } = await client.auth.exchangeCodeForSession(
      credentials.code,
    );
    if (!error) return data.user?.id ?? null;
  } else {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: credentials.tokenHash,
      type: "recovery",
    });
    if (!error) return data.user?.id ?? null;
  }
  return null;
}

export async function getWebAccessToken(): Promise<
  | { success: true; data: string | null }
  | { success: false; error: AuthFailure }
> {
  const client = getWebClient();
  if (!client) {
    return {
      success: false,
      error: authFailure(
        "Supabase authentication is not configured.",
        undefined,
        "AUTH_NOT_CONFIGURED",
      ),
    };
  }
  const { data, error } = await client.auth.getSession();
  if (error) {
    return {
      success: false,
      error: authFailure("Could not read the saved Supabase session.", error),
    };
  }
  let session = data.session;
  if (
    session &&
    (typeof session.expires_at !== "number" ||
      session.expires_at <=
        Math.floor(Date.now() / 1000) + ACCESS_TOKEN_REFRESH_MARGIN_SECONDS)
  ) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error) {
      return {
        success: false,
        error: authFailure(
          "The Supabase session could not be refreshed.",
          refreshed.error,
        ),
      };
    }
    session = refreshed.data.session;
  }
  return { success: true, data: session?.access_token ?? null };
}

export async function sendWebAuthRuntimeMessage(
  request: AuthRuntimeRequest,
): Promise<AuthRuntimeResponse> {
  const client = getWebClient();
  if (!client) {
    return failureResponse(
      request,
      authFailure(
        "Supabase authentication is not configured.",
        undefined,
        "AUTH_NOT_CONFIGURED",
      ),
    );
  }

  try {
    switch (request.type) {
      case "AUTH_GET_STATUS": {
        const { data, error } = await client.auth.getSession();
        if (error) {
          return failureResponse(
            request,
            authFailure("Could not restore the saved Supabase session.", error),
          );
        }
        const user = safeUser(data.session?.user);
        const status: AuthStatus = {
          configured: true,
          authenticated: Boolean(data.session && user),
          ...(user ? { user } : {}),
        };
        return {
          type: request.type,
          result: { success: true, data: status },
        };
      }
      case "AUTH_SIGN_UP": {
        const { data, error } = await client.auth.signUp({
          email: request.email,
          password: request.password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) {
          return failureResponse(
            request,
            authFailure("Supabase could not create the account.", error),
          );
        }
        const result: SafeAuthMutation = {
          user: safeUser(data.user) ?? null,
          requiresEmailConfirmation: !data.session,
        };
        return {
          type: request.type,
          result: { success: true, data: result },
        };
      }
      case "AUTH_SIGN_IN": {
        const { data, error } = await client.auth.signInWithPassword({
          email: request.email,
          password: request.password,
        });
        if (error) {
          return failureResponse(
            request,
            authFailure("Supabase could not sign in.", error),
          );
        }
        const result: SafeAuthMutation = {
          user: safeUser(data.user) ?? null,
          requiresEmailConfirmation: false,
        };
        return {
          type: request.type,
          result: { success: true, data: result },
        };
      }
      case "AUTH_SIGN_IN_WITH_GOOGLE": {
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: `${window.location.origin}/` },
        });
        if (error) {
          return failureResponse(
            request,
            authFailure(
              "Google sign-in could not be started.",
              error,
            ),
          );
        }
        const result: SafeAuthMutation = {
          user: null,
          requiresEmailConfirmation: false,
        };
        return {
          type: request.type,
          result: { success: true, data: result },
        };
      }
      case "AUTH_SEND_PASSWORD_RECOVERY": {
        const { error } = await client.auth.resetPasswordForEmail(
          request.email,
          { redirectTo: `${window.location.origin}/?flow=recovery` },
        );
        return error
          ? failureResponse(
              request,
              authFailure("Supabase could not send the recovery email.", error),
            )
          : { type: request.type, result: { success: true, data: null } };
      }
      case "AUTH_VERIFY_PASSWORD_RECOVERY": {
        const userId = await recoveryUserId(request.credentials);
        if (!userId) {
          return failureResponse(
            request,
            authFailure(
              "This password reset link is invalid or has expired. Request a new one.",
            ),
          );
        }
        recoverySession = {
          userId,
          expiresAt: Date.now() + PASSWORD_RECOVERY_MARKER_TTL_MS,
        };
        return { type: request.type, result: { success: true, data: null } };
      }
      case "AUTH_CHANGE_PASSWORD": {
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError || !userData.user?.email) {
          return failureResponse(
            request,
            authFailure("Your current account could not be verified.", userError),
          );
        }
        if (!safeUser(userData.user)?.hasPassword) {
          return failureResponse(
            request,
            authFailure("This account has no password. Use password recovery."),
          );
        }
        const verification = await client.auth.signInWithPassword({
          email: userData.user.email,
          password: request.currentPassword,
        });
        if (verification.error) {
          return failureResponse(
            request,
            authFailure("Your current password is incorrect.", verification.error),
          );
        }
        const updated = await client.auth.updateUser({
          password: request.newPassword,
        });
        return updated.error
          ? failureResponse(
              request,
              authFailure("Supabase could not update your password.", updated.error),
            )
          : { type: request.type, result: { success: true, data: null } };
      }
      case "AUTH_RESET_PASSWORD": {
        if (!recoverySession || recoverySession.expiresAt <= Date.now()) {
          recoverySession = null;
          return failureResponse(
            request,
            authFailure(
              "This password reset link is invalid or has expired. Request a new one.",
            ),
          );
        }
        const { data, error: userError } = await client.auth.getUser();
        if (userError || data.user?.id !== recoverySession.userId) {
          recoverySession = null;
          return failureResponse(
            request,
            authFailure(
              "This password reset link is invalid or has expired. Request a new one.",
              userError,
            ),
          );
        }
        const update = await client.auth.updateUser({
          password: request.newPassword,
        });
        if (update.error) {
          return failureResponse(
            request,
            authFailure("Supabase could not update your password.", update.error),
          );
        }
        const signOut = await client.auth.signOut({ scope: "local" });
        recoverySession = null;
        return signOut.error
          ? failureResponse(
              request,
              authFailure("The recovery session could not be cleared.", signOut.error),
            )
          : { type: request.type, result: { success: true, data: null } };
      }
      case "AUTH_SIGN_OUT": {
        const { error } = await client.auth.signOut();
        return error
          ? failureResponse(request, authFailure("Supabase could not sign out.", error))
          : { type: request.type, result: { success: true, data: null } };
      }
    }
  } catch (error) {
    return failureResponse(
      request,
      authFailure("The authentication service could not complete the request.", error),
    );
  }
}
