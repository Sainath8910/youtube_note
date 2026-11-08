import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, createClient } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOAuth: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    verifyOtp: vi.fn(),
    setSession: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
  },
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));

const user = {
  id: "supabase-user-uuid",
  email: "reader@example.test",
  app_metadata: { providers: ["email"] },
  identities: [{ provider: "email" }],
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
  vi.stubGlobal("window", { location: { origin: "http://localhost:8000" } });
  for (const mock of Object.values(auth)) mock.mockReset();
  auth.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.signUp.mockResolvedValue({
    data: { user, session: { access_token: "access" } },
    error: null,
  });
  auth.signInWithPassword.mockResolvedValue({
    data: { user, session: { access_token: "access" } },
    error: null,
  });
  auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  auth.verifyOtp.mockResolvedValue({ data: { user }, error: null });
  auth.setSession.mockResolvedValue({ data: { user }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({
    data: { user, session: { access_token: "recovery" } },
    error: null,
  });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  auth.refreshSession.mockResolvedValue({
    data: { session: { access_token: "refreshed" } },
    error: null,
  });
  createClient.mockReturnValue({ auth });
});

describe("browser Supabase authentication provider", () => {
  it("restores a signed-in session and preserves the Supabase user UUID", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user } },
      error: null,
    });
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    await expect(
      sendWebAuthRuntimeMessage({ type: "AUTH_GET_STATUS" }),
    ).resolves.toMatchObject({
      type: "AUTH_GET_STATUS",
      result: {
        success: true,
        data: {
          authenticated: true,
          user: { id: "supabase-user-uuid", email: "reader@example.test" },
        },
      },
    });
  });

  it("returns a signed-out status when no browser session exists", async () => {
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    await expect(
      sendWebAuthRuntimeMessage({ type: "AUTH_GET_STATUS" }),
    ).resolves.toMatchObject({
      result: {
        success: true,
        data: { configured: true, authenticated: false },
      },
    });
  });

  it("supports email sign-in and signup through the public Supabase client", async () => {
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    const signIn = await sendWebAuthRuntimeMessage({
      type: "AUTH_SIGN_IN",
      email: "reader@example.test",
      password: "example-password",
    });
    const signUp = await sendWebAuthRuntimeMessage({
      type: "AUTH_SIGN_UP",
      email: "reader@example.test",
      password: "example-password",
    });

    expect(signIn.type).toBe("AUTH_SIGN_IN");
    expect(signUp.type).toBe("AUTH_SIGN_UP");
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(auth.signUp).toHaveBeenCalledOnce();
  });

  it("starts Google OAuth with a same-origin redirect", async () => {
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    const result = await sendWebAuthRuntimeMessage({
      type: "AUTH_SIGN_IN_WITH_GOOGLE",
    });

    expect(result.type).toBe("AUTH_SIGN_IN_WITH_GOOGLE");
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:8000/" },
    });
  });

  it("obtains the API bearer token from the Supabase-managed session", async () => {
    auth.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "session-access-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    });
    const { getWebAccessToken } = await import("./webAuth");

    await expect(getWebAccessToken()).resolves.toEqual({
      success: true,
      data: "session-access-token",
    });
  });

  it("rejects password recovery without a verified recovery link", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    const result = await sendWebAuthRuntimeMessage({
      type: "AUTH_VERIFY_PASSWORD_RECOVERY",
      credentials: { tokenHash: "invalid-token-hash" },
    });

    expect(result).toMatchObject({
      type: "AUTH_VERIFY_PASSWORD_RECOVERY",
      result: { success: false },
    });
  });

  it("supports password recovery, reset, and logout", async () => {
    const { sendWebAuthRuntimeMessage } = await import("./webAuth");

    const recovery = await sendWebAuthRuntimeMessage({
      type: "AUTH_VERIFY_PASSWORD_RECOVERY",
      credentials: { tokenHash: "verified-token-hash" },
    });
    const reset = await sendWebAuthRuntimeMessage({
      type: "AUTH_RESET_PASSWORD",
      newPassword: "new-example-password",
    });
    const signOut = await sendWebAuthRuntimeMessage({
      type: "AUTH_SIGN_OUT",
    });

    expect(recovery).toMatchObject({ result: { success: true } });
    expect(reset).toMatchObject({ result: { success: true } });
    expect(signOut).toMatchObject({ result: { success: true } });
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "new-example-password",
    });
    expect(auth.signOut).toHaveBeenCalledTimes(2);
  });
});
