export function deploymentEnvironmentForHostname(hostname = globalThis.window?.location?.hostname || '') {
  const normalized = String(hostname || '').toLowerCase();
  if (normalized.includes('staging')) {
    return {
      kind: 'staging',
      label: 'STAGING',
      appName: 'JobDone Staging',
      manifestPath: '/manifest-staging.webmanifest',
      bannerClassName: 'bg-amber-500 text-amber-950',
    };
  }
  if (normalized === 'jobdone-frontend-production.vercel.app' || normalized === 'jobdone.continuumkit.org') {
    return {
      kind: 'production',
      label: 'PRODUCTION',
      appName: 'JobDone Production',
      manifestPath: '/manifest-production.webmanifest',
      bannerClassName: 'bg-emerald-600 text-white',
    };
  }
  return null;
}

export const currentDeploymentEnvironment = deploymentEnvironmentForHostname();
