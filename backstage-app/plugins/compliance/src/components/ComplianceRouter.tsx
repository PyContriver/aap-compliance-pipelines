import React from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  Page,
  Header,
  HeaderTabs,
  Content,
  ErrorPanel,
} from '@backstage/core-components';
import { Typography, Box, Button } from '@material-ui/core';
import { ComplianceDashboard } from './ComplianceDashboard';
import { ProfileBrowser } from './ProfileBrowser';
import { ScanLauncher } from './ScanLauncher';
import { ResultsViewer } from './ResultsViewer';
import { RemediationProfileBuilder } from './RemediationProfileBuilder';
import { RemediationExecution } from './RemediationExecution';
import { CartridgeSettings } from './CartridgeSettings';
import { RemediationsList } from './RemediationsList';
import { ScanHistory } from './ScanHistory';
import { ActiveJobsBanner } from './ActiveJobsBanner';

/**
 * Error boundary for the Compliance tab.
 *
 * React error boundaries must be class components. This catches any unhandled
 * exception in a child route and renders a Backstage ErrorPanel instead of
 * crashing the entire tab.
 */
class ComplianceErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <Box p={4}>
          <ErrorPanel
            title="Something went wrong in the Compliance plugin"
            error={error}
          />
          <Box mt={2} display="flex" justifyContent="center">
            <Button
              variant="outlined"
              onClick={() => this.setState({ error: undefined })}
            >
              Try Again
            </Button>
          </Box>
        </Box>
      );
    }
    return this.props.children;
  }
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'scan', label: 'New Scan' },
  { id: 'results', label: 'Results' },
  { id: 'remediations', label: 'Remediations' },
  { id: 'settings', label: 'Settings' },
];

const tabRouteMap: Record<string, string> = {
  overview: '',
  profiles: 'profiles/all',
  scan: 'scan',
  results: 'results',
  remediations: 'remediations',
  settings: 'settings',
};

const ComplianceRouter = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive selected tab from URL on every render so browser back/forward stays in sync.
  const getSelectedTab = (): number => {
    const path = location.pathname.replace(/^\/compliance\/?/, '');
    if (path.startsWith('profiles')) return 1;
    if (path.startsWith('scan')) return 2;
    if (path.startsWith('results') || path.startsWith('remediation/') || path.startsWith('execute')) return 3;
    if (path === 'remediations' || path.startsWith('remediation-edit/')) return 4;
    if (path.startsWith('settings')) return 5;
    return 0;
  };

  const selectedTab = getSelectedTab();

  const handleTabChange = (index: number) => {
    const tab = TABS[index];
    navigate(tabRouteMap[tab.id] || '');
  };

  return (
    <>
      <Page themeId="app">
        <Header
          title="Compliance"
          subtitle="Scan, review, and remediate infrastructure compliance"
          style={{ background: 'inherit' }}
        />
        <HeaderTabs
          selectedIndex={selectedTab}
          onChange={handleTabChange}
          tabs={TABS}
        />
        <Content>
          <ComplianceErrorBoundary>
            <Routes>
              <Route path="/" element={<ComplianceDashboard />} />
              <Route path="/profiles/:profileId" element={<ProfileBrowser />} />
              <Route path="/scan" element={<ScanLauncher />} />
              <Route path="/results" element={<ScanHistory />} />
              <Route path="/results/:jobId" element={<ResultsViewer />} />
              <Route path="/remediation/:jobId" element={<RemediationProfileBuilder />} />
              <Route path="/remediation-edit/:remediationId" element={<RemediationProfileBuilder />} />
              <Route path="/execute/:jobId" element={<RemediationExecution />} />
              <Route path="/remediation-result/:jobId" element={<RemediationExecution />} />
              <Route path="/remediations" element={<RemediationsList />} />
              <Route path="/settings" element={<CartridgeSettings />} />
            </Routes>
          </ComplianceErrorBoundary>
        </Content>
      </Page>
      <ActiveJobsBanner />
    </>
  );
};

export { ComplianceRouter };
