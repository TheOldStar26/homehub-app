// Use the Edge runtime's native fetch for network I/O. web-push generates the
// encrypted payload and VAPID headers without relying on Node HTTPS sockets.
export function pushTransport(webpush, fetcher = fetch) {
  return { async sendNotification(subscription, payload, options) {
    const details = webpush.generateRequestDetails(subscription, payload, { TTL: options.TTL });
    const response = await fetcher(details.endpoint, {
      method: details.method, headers: details.headers, body: details.body,
      signal: AbortSignal.timeout(options.timeout),
    });
    if (!response.ok) {
      let reason = '';
      try { const body = await response.json(); if (/^[A-Za-z]{1,60}$/.test(body.reason)) reason = body.reason; } catch {}
      const error = new Error('Push provider rejected delivery');
      error.statusCode = response.status; error.providerReason = reason; throw error;
    }
    await response.body?.cancel();
  }};
}
