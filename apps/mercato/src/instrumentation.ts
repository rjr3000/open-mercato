import { isTelemetryBackendEnabled } from '@open-mercato/shared/lib/telemetry/runtime'

export async function register(): Promise<void> {
  // Cloudflare Workers: MikroORM reads process.env.DATABASE_URL, but on Workers
  // the Postgres connection must come from the Hyperdrive binding, whose
  // connectionString only exists inside the Worker env. Resolve it here — the
  // earliest server hook — and publish it before any module can call getOrm().
  if (
    process.env.NEXT_RUNTIME === 'nodejs'
    && process.env.NEXT_PHASE !== 'phase-production-build'
    && !process.env.DATABASE_URL
  ) {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const { env } = await getCloudflareContext({ async: true }) as { env: { HYPERDRIVE?: { connectionString?: string } } }
      if (env?.HYPERDRIVE?.connectionString) {
        process.env.DATABASE_URL = env.HYPERDRIVE.connectionString
      }
    } catch {
      // Not running on Cloudflare (plain Node host) — DATABASE_URL comes from env.
    }
  }
  // Refuse to serve traffic in production with a missing, placeholder, or too-short JWT signing
  // secret: those tokens are forgeable by anyone who has read the published compose files. Skipped
  // during `next build`, which has no need to sign anything and runs where secrets may be absent.
  if (
    process.env.NEXT_RUNTIME === 'nodejs'
    && process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { assertJwtSecretPolicy } = await import('@open-mercato/shared/lib/auth/jwt')
    try {
      assertJwtSecretPolicy()
    } catch (err) {
      // Next.js reports a throwing instrumentation hook as an unhandled rejection and then leaves
      // the process running, answering 500s — an orchestrator would read that container as healthy
      // and never roll the deployment back. Exit instead, so the misconfiguration is impossible to
      // miss. The message goes straight to stderr because the logger transport may buffer and we
      // are about to terminate.
      const nodeProcess = process
      nodeProcess.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      nodeProcess.exit(1)
    }
  }

  // dev warmup is handled by the dev runner splash flow.
  // Initialize telemetry (no-op unless TELEMETRY_BACKEND is set). OTEL's NodeSDK
  // is Node-only and incompatible with the edge runtime, so the telemetry
  // bootstrap — which can pull in the SDK — is imported only on the Node.js
  // runtime. The helper owns init + graceful degrade + shutdown flush; a
  // deliberate configuration failure bubbles here so the host exits loudly.
  if (
    process.env.NEXT_RUNTIME === 'nodejs'
    && isTelemetryBackendEnabled()
  ) {
    const { registerTelemetryForNextjs } = await import('@open-mercato/telemetry/nextjs')
    try {
      await registerTelemetryForNextjs()
    } catch (err) {
      const nodeProcess = process
      nodeProcess.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      nodeProcess.exit(1)
    }
  }
}
