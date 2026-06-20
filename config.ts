// App-wide configuration for Hey Emma (read-only Olivia analytics dashboard).
const config = {
  appName: "Hey Emma",
  appDescription:
    "Read-only analytics dashboard for your Olivia workspace — leads, calls, campaigns and outcomes.",
  // Naked domain (no protocol, no trailing slash).
  domainName: "heyemma.io",
  auth: {
    // Where unauthenticated users are sent.
    loginUrl: "/login",
    // Where users land after a successful login.
    callbackUrl: "/dashboard",
  },
} as const;

export default config;
