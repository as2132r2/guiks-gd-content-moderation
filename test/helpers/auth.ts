export interface RequestApp {
  request: (input: string | Request, init?: RequestInit) => Response | Promise<Response>;
}

export async function loginAs(app: RequestApp, username = 'zhangmin'): Promise<string> {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, demo: true }),
  });
  if (response.status !== 200) {
    throw new Error(`login failed for ${username}: ${response.status} ${await response.text()}`);
  }
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`login for ${username} did not set a session cookie`);
  return setCookie.split(';', 1)[0]!;
}

export function authenticatedRequest(app: RequestApp, cookie: string) {
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('cookie', cookie);
    return app.request(path, { ...init, headers });
  };
}
