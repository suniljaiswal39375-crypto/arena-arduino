import { expect, test } from '@playwright/test';

test('unconfigured classrooms explain setup without blocking the local lab', async ({ page, request }) => {
  test.skip(!!process.env.CLASSROOM_UI_TESTS, 'This assertion needs the zero-config deployment.');
  await page.goto('/classrooms');
  await expect(page.getByRole('heading', { name: 'Classroom accounts are not configured' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the local lab' })).toHaveAttribute('href', '/builder');
  for (const path of ['/api/classrooms', '/api/auth/session']) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Classroom data and privacy', exact: true })).toBeVisible();
});

test('configured student workspace joins, submits a snapshot and shows feedback', async ({ page }) => {
  test.skip(!process.env.CLASSROOM_UI_TESTS, 'Run against a configured test server; APIs are intercepted, not real OAuth.');
  const classId = '11111111-1111-4111-8111-111111111111';
  const assignmentId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';
  let joined = false;
  let submitted = false;
  const assignment = { id: assignmentId, classroomId: classId, title: 'Traffic light homework', missionSlug: 'traffic-light', dueAt: null, createdAt: new Date().toISOString() };
  await page.route('**/api/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/classrooms', '');
    let data: unknown;
    if (path === '') data = { user: { id: studentId, name: 'Student', role: 'student' }, classrooms: joined ? [{ id: classId, name: 'Grade eight', relationship: 'student', archived: false }] : [] };
    else if (path === '/join') { expect(route.request().postDataJSON()).toEqual({ code: 'ABC234' }); joined = true; data = { id: classId }; }
    else if (path === `/${classId}`) data = { classroom: { id: classId, name: 'Grade eight', archived: false }, relationship: 'student', assignments: [assignment] };
    else if (path.endsWith('/submission')) { expect(route.request().postDataJSON().project.name).toBe('My circuit'); submitted = true; data = { version: 1 }; }
    else data = { assignment, submissions: submitted ? [{ studentId, assignmentId, version: 1, reviewStatus: 'reviewed', feedback: 'Nice resistor choice', submittedAt: new Date().toISOString() }] : [] };
    await route.fulfill({ json: data, headers: { 'Cache-Control': 'no-store' } });
  });
  await page.goto('/classrooms');
  await page.getByLabel('Six-character code').fill('ABC234');
  await page.getByRole('button', { name: 'Join classroom', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Grade eight' })).toBeVisible();
  await expect(page.getByText('Private join code:')).toHaveCount(0);
  await page.getByRole('button', { name: 'Traffic light homework', exact: true }).click();
  await page.getByLabel('Project snapshot').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'My circuit' })) });
  await page.getByRole('button', { name: 'Submit snapshot', exact: true }).click();
  await expect(page.getByText('Teacher feedback: Nice resistor choice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save review' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('configured teacher creates an assignment and submits a version-checked review', async ({ page }) => {
  test.skip(!process.env.CLASSROOM_UI_TESTS, 'Requires a configured test server with intercepted APIs.');
  let created = false;
  let assigned = false;
  let reviewed = false;
  const c = '11111111-1111-4111-8111-111111111111';
  const a = '22222222-2222-4222-8222-222222222222';
  const s = '33333333-3333-4333-8333-333333333333';
  const assignment = { id: a, classroomId: c, title: 'First circuit', missionSlug: 'traffic-light', dueAt: null, createdAt: new Date().toISOString() };
  const submission = { studentId: s, assignmentId: a, version: 2, reviewStatus: 'submitted', feedback: '', submittedAt: new Date().toISOString(), project: {} };
  await page.route('**/api/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/classrooms', '');
    const method = route.request().method();
    let data: unknown;
    if (path === '' && method === 'POST') { expect(route.request().postDataJSON()).toEqual({ name: 'Science class' }); created = true; data = { id: c }; }
    else if (path === '') data = { user: { id: 'teacher', name: 'Teacher', role: 'teacher' }, classrooms: created ? [{ id: c, name: 'Science class', relationship: 'owner' }] : [] };
    else if (path === `/${c}`) data = { classroom: { id: c, name: 'Science class', joinCode: 'ABC234', archived: false }, relationship: 'owner', students: [{ id: s, name: 'Learner one' }], assignments: assigned ? [assignment] : [] };
    else if (path === `/${c}/assignments`) { expect(route.request().postDataJSON().title).toBe('First circuit'); assigned = true; data = assignment; }
    else if (path.endsWith(`/submissions/${s}`) && method === 'PATCH') { expect(route.request().postDataJSON()).toEqual({ version: 2, status: 'needs-work', feedback: 'Check the ground wire' }); reviewed = true; data = submission; }
    else if (path.endsWith(`/submissions/${s}`)) data = submission;
    else data = { assignment, submissions: [{ ...submission, ...(reviewed ? { feedback: 'Check the ground wire', reviewStatus: 'needs-work' } : {}) }] };
    await route.fulfill({ json: data });
  });
  await page.goto('/classrooms');
  await page.getByLabel('Classroom name').fill('Science class');
  await page.getByRole('button', { name: 'Create classroom', exact: true }).click();
  await expect(page.getByText('ABC234', { exact: true })).toBeVisible();
  await page.getByLabel('Assignment title').fill('First circuit');
  await page.getByRole('button', { name: 'Assign mission', exact: true }).click();
  await page.getByRole('button', { name: 'First circuit', exact: true }).click();
  await page.getByRole('button', { name: 'Review submission', exact: true }).click();
  await page.getByRole('combobox', { name: 'Result', exact: true }).selectOption('needs-work');
  await page.getByLabel('Feedback', { exact: true }).fill('Check the ground wire');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByText('Teacher feedback: Check the ground wire')).toBeVisible();
  expect(reviewed).toBe(true);
});

test('student progress is labelled honestly and leaving requires confirmation', async ({ page }) => {
  test.skip(!process.env.CLASSROOM_UI_TESTS, 'Requires configured test server and intercepted API.');
  let left = false;
  await page.route('**/api/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/classrooms', '');
    let data: unknown;
    if (path === '/c/leave') { expect(route.request().postDataJSON()).toEqual({ confirmation: 'REMOVE MEMBERSHIP' }); left = true; data = { removed: true }; }
    else if (!path) data = { user: { id: 's', name: 'Student', role: 'student' }, classrooms: left ? [] : [{ id: 'c', name: 'My class', relationship: 'student' }] };
    else data = { classroom: { id: 'c', name: 'My class', archived: false }, relationship: 'student', assignments: [], progress: [{ id: 's', name: 'Student', cells: [{ assignmentId: 'a', title: 'Blink', status: 'needs-work', version: 2, late: true, submittedAt: new Date().toISOString() }] }] };
    await route.fulfill({ json: data });
  });
  await page.goto('/classrooms');
  await page.getByRole('button', { name: 'My class · student' }).click();
  await expect(page.getByRole('heading', { name: 'Submission progress' })).toBeVisible();
  await expect(page.getByText(/not verified mission completion/)).toBeVisible();
  await expect(page.getByRole('cell', { name: /Needs work.*Version 2.*Late/ })).toBeVisible();
  await page.getByText('Classroom privacy controls', { exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Leave classroom and delete my work' }).click();
  expect(left).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Leave classroom and delete my work' }).click();
  await expect(page.getByText('You left the classroom. Your submissions there were deleted.')).toBeVisible();
  expect(left).toBe(true);
});

test('personal metadata downloads and account deletion clears other open tabs', async ({ page, context }) => {
  test.skip(!process.env.CLASSROOM_UI_TESTS, 'Requires configured test server and intercepted API.');
  let deleted = false;
  let holdNextList = false;
  let releasePending: (() => void) | undefined;
  await context.route('**/api/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/classrooms', '');
    let data: unknown;
    if (path === '/privacy/export') data = { account: { name: 'Private learner' }, submissions: [] };
    else if (path === '/privacy/delete') { expect(route.request().postDataJSON()).toEqual({ confirmation: 'DELETE MY ACCOUNT' }); deleted = true; data = { deleted: true }; }
    else data = { user: { id: 's', name: 'Private learner', role: 'student' }, classrooms: [] };
    if (!path && holdNextList) { holdNextList = false; await new Promise<void>(resolve => { releasePending = resolve; }); }
    await route.fulfill({ json: data });
  });
  await page.goto('/classrooms');
  const other = await context.newPage(); await other.goto('/classrooms');
  await expect(other.getByText('Private learner · student')).toBeVisible();
  await page.getByText('Privacy and account controls', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my account metadata' }).click();
  expect((await download).suggestedFilename()).toBe('classroom-personal-data.json');
  const remove = page.getByRole('button', { name: 'Permanently delete my account', exact: true });
  await expect(remove).toBeDisabled();
  await page.getByLabel('Type DELETE MY ACCOUNT to confirm').fill('DELETE MY ACCOUNT');
  holdNextList = true;
  await other.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => !!releasePending).toBe(true);
  await remove.click();
  await expect(page.getByRole('heading', { name: 'Sign in to your classroom' })).toBeVisible();
  await expect(other.getByText('Private learner · student')).toHaveCount(0);
  await expect(other.getByRole('heading', { name: 'Sign in to your classroom' })).toBeVisible();
  releasePending?.();
  await expect(other.getByRole('status')).not.toHaveText('Working…');
  await expect(other.getByText('Private learner · student')).toHaveCount(0);
  expect(deleted).toBe(true);
});

test('teacher removal and permanent classroom deletion expose explicit warnings', async ({ page }) => {
  test.skip(!process.env.CLASSROOM_UI_TESTS, 'Requires configured test server and intercepted API.');
  let removed = false;
  let deleted = false;
  await page.route('**/api/classrooms**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/classrooms', '');
    let data: unknown;
    if (path === '/c/members/s/remove') { expect(route.request().postDataJSON()).toEqual({ confirmation: 'REMOVE MEMBERSHIP' }); removed = true; data = { removed: true }; }
    else if (path === '/c/delete') { expect(route.request().postDataJSON()).toEqual({ confirmation: 'DELETE CLASSROOM' }); deleted = true; data = { deleted: true }; }
    else if (!path) data = { user: { id: 't', name: 'Teacher', role: 'teacher' }, classrooms: deleted ? [] : [{ id: 'c', name: 'My class', relationship: 'owner' }] };
    else data = { classroom: { id: 'c', name: 'My class', joinCode: 'ABC234', archived: false }, relationship: 'owner', assignments: [], students: removed ? [] : [{ id: 's', name: 'Member' }], progress: [] };
    await route.fulfill({ json: data });
  });
  await page.goto('/classrooms');
  await page.getByRole('button', { name: 'My class · owner' }).click();
  await page.getByText('Class roster (1)', { exact: true }).click();
  page.once('dialog', dialog => { expect(dialog.message()).toContain('permanently delete'); return dialog.accept(); });
  await page.getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByText('Class roster (0)', { exact: true })).toBeVisible();
  expect(removed).toBe(true);
  await page.getByText('Classroom privacy controls', { exact: true }).click();
  await page.getByLabel('Type DELETE CLASSROOM to confirm').fill('DELETE CLASSROOM');
  await page.getByRole('button', { name: 'Permanently delete classroom', exact: true }).click();
  await expect(page.getByText('Classroom and associated records permanently deleted.')).toBeVisible();
  expect(deleted).toBe(true);
});
