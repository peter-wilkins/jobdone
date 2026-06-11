import React from 'react'

import { recentApiRequests } from './services/requestDiagnosticsService.js'

const BUILD_ID = import.meta.env.VITE_DEPLOYMENT_ID || import.meta.env.VITE_BUILD_ID || 'dev'

export class BrokenAppBoundary extends React.Component {
  state = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    console.error('[JobDone] App bootstrap failed:', error, errorInfo);
  }

  componentDidMount() {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  handleWindowError = () => {
    this.setState({ hasError: true });
    return false;
  };

  handleUnhandledRejection = (event) => {
    this.setState({ hasError: true, error: event?.reason });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const latestRequestId = recentApiRequests(1).at(0)?.request_id || 'unknown';

    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center px-6">
        <div className="max-w-xl w-full text-center p-8 border border-gray-200 rounded-lg shadow-sm">
          <h1 className="text-2xl font-semibold mb-2">We are broken</h1>
          <p className="text-sm text-gray-600">
            We will be back soon, folks.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              className="px-3 py-2 text-sm rounded-md bg-gray-900 text-white hover:bg-black"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
          <p className="mt-6 text-[11px] leading-4 text-gray-400 font-mono">
            build {BUILD_ID} | request {latestRequestId}
          </p>
        </div>
      </div>
    );
  }
}
