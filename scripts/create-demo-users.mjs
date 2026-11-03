import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const users = [
  {
    email: 'technician@asqac.test',
    name: 'Demo Technician',
    role: 'technician',
    password: process.env.DEMO_TECHNICIAN_PASSWORD || 'technician',
  },
  {
    email: 'doctor@asqac.test',
    name: 'Dr. Demo Receiver',
    role: 'doctor',
    password: process.env.DEMO_DOCTOR_PASSWORD || 'doctor',
  },
];
for (const user of users)
  if (!user.password || user.password.length < 6)
    throw new Error(`Set a password of at least 6 characters for ${user.email}.`);
for (const user of users) {
  const { data, error } = await db.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { full_name: user.name },
  });
  let id = data.user?.id;
  if (error) {
    if (
      !['email_exists', 'email_address_exists'].includes(error.code) &&
      !error.message.toLowerCase().includes('already')
    )
      throw error;
    for (let page = 1; !id; page++) {
      const { data: list, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (e) throw e;
      id = list.users.find((u) => u.email === user.email)?.id;
      if (list.users.length < 1000) break;
    }
  }
  if (!id) throw new Error(`Unable to find ${user.email}`);
  if (error) {
    const { error: resetError } = await db.auth.admin.updateUserById(id, {
      password: user.password,
      email_confirm: true,
      user_metadata: { full_name: user.name },
    });
    if (resetError) throw resetError;
  }
  const { error: profileCheck } = await db.from('profiles').select('id').limit(1);
  if (profileCheck) {
    console.log(
      `${user.email} Auth account ready; apply the SQL setup to create its staff profile.`,
    );
    continue;
  }
  const { error: profileError } = await db
    .from('profiles')
    .upsert({ id, email: user.email, full_name: user.name, role: user.role });
  if (profileError) throw profileError;
  console.log(`${user.email} → ${user.role} ready (email confirmed).`);
}
