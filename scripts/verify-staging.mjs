const required = ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_SERVICE_ROLE_KEY']
for (const name of required) {
  if (!process.env[name]?.trim()) {
    console.error(`${name} is required.`)
    process.exitCode = 2
  }
}
if (process.exitCode) process.exit()

const base = process.env.STAGING_SUPABASE_URL.replace(/\/$/, '')
const headers = {
  apikey: process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  authorization: `Bearer ${process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
}

async function check(path, label) {
  const response = await fetch(`${base}${path}`, { headers })
  if (!response.ok) {
    console.error(`${label} failed with HTTP ${response.status}.`)
    console.error(await response.text())
    process.exit(1)
  }
  return response
}

await check('/rest/v1/workspaces?select=id&limit=1', 'Staging Supabase health check')
await check('/rest/v1/simulations?select=id&limit=1', 'Simulator migration check')
await check('/rest/v1/conversations?select=id&limit=1', 'Conversation schema check')

/*
 * The service role intentionally bypasses RLS. This verifies that the
 * simulator relation exists; the pgTAP suite remains the authoritative RLS
 * check and must run against the linked staging database.
 */
console.log('Staging Supabase REST health check passed.')
console.log('Simulator relation check passed.')
console.log('Next required check: run `supabase test db` against the linked staging project and execute the authenticated simulator flow with a server-side OPENAI_API_KEY.')
