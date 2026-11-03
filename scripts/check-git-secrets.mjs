import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const paths = execFileSync('git', ['-c', 'safe.directory=D:/college/ASQAC', 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenPaths = paths.filter((p) => /(^|\/)\.env(?:\.|$)/.test(p) && !p.endsWith('.env.example') || /(^|\/)(?:node_modules|artifacts|\.vercel)\//.test(p) || /(^|\/)secrets\.h$/.test(p));
if (forbiddenPaths.length) throw new Error(`Excluded local files were staged: ${forbiddenPaths.join(', ')}`);
const adminValues = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].map((key) => process.env[key]).filter(Boolean);
for (const filename of paths) {
  const contents = await readFile(filename, 'utf8');
  if (adminValues.some((value) => contents.includes(value)) || /sb_secret_[A-Za-z0-9_-]+|gho_[A-Za-z0-9]{20,}/.test(contents))
    throw new Error(`Administrative credential found in ${filename}`);
  for (const token of contents.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(token[1], 'base64url').toString()).role === 'service_role')
        throw new Error(`Administrative JWT found in ${filename}`);
    } catch (error) {
      if (error.message.startsWith('Administrative')) throw error;
    }
  }
}
console.log(`PASS ${paths.length} staged files: no local environment files, tool caches or administrative credentials. The documented demo device token is intentionally included.`);
