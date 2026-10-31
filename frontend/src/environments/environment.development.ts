function resolveBackendBase(): string {
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    // Devtunnel support: if frontend is on ...-4200.devtunnels.ms, backend is on ...-5000.devtunnels.ms
    if (hostname.includes('.devtunnels.ms') && hostname.includes('-4200.')) {
      return `${protocol}//${hostname.replace('-4200.', '-5000.')}`;
    }
    // LAN IP support: e.g. http://192.168.x.x:5000
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return `${protocol}//${hostname}:5000`;
    }
  }
  return 'http://localhost:5000';
}

const backendBase = resolveBackendBase();

export const environment = {
  production: false,
  backendUrl: backendBase,
  apiUrl: `${backendBase}/api`
};
