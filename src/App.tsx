import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/contexts/AuthContext";
import { TenantProvider } from "@/contexts/TenantContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import ResellerProtectedRoute from "@/components/auth/ResellerProtectedRoute";
import DistributorProtectedRoute from "@/components/auth/DistributorProtectedRoute";
import CustomerProtectedRoute from "@/components/auth/CustomerProtectedRoute";
import Landing from "./pages/Landing";
import BlogIndex from "./pages/BlogIndex";
import BlogPost from "./pages/BlogPost";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";
import Security from "./pages/legal/Security";
import AcceptableUse from "./pages/legal/AcceptableUse";
import Status from "./pages/legal/Status";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Endpoints from "./pages/Endpoints";
import Groups from "./pages/Groups";
import Threats from "./pages/Threats";
import Policies from "./pages/Policies";
import AgentDownload from "./pages/AgentDownload";
import EventLogs from "./pages/EventLogs";
import Activity from "./pages/Activity";
import Admin from "./pages/Admin";
import AdminOverview from "./pages/AdminOverview";
import SystemHealth from "./pages/SystemHealth";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Recommendations from "./pages/Recommendations";
import ThreatHunting from "./pages/ThreatHunting";
import Network from "./pages/Network";
import Microsegmentation from "./pages/Microsegmentation";
import AppWhitelisting from "./pages/AppWhitelisting";
import Glossary from "./pages/Glossary";
import Telemetry from "./pages/Telemetry";
import DnsFiltering from "./pages/DnsFiltering";
import Guides from "./pages/Guides";
import Routers from "./pages/Routers";
import Reports from "./pages/Reports";
import GroupPolicy from "./pages/GroupPolicy";
import EndpointDetail from "./pages/EndpointDetail";
import Alerts from "./pages/Alerts";
import Incidents from "./pages/Incidents";
import IncidentDetail from "./pages/IncidentDetail";
import HelpSops from "./pages/HelpSops";
import CustomerReports from "./pages/CustomerReports";
import MyCustomers from "./pages/MyCustomers";
import Sites from "./pages/Sites";
import SiteDetail from "./pages/SiteDetail";
import ResetPassword from "./pages/ResetPassword";
import LegacyHardening from "./pages/LegacyHardening";
import Help from "./pages/Help";
import Vulnerabilities from "./pages/Vulnerabilities";
import M365 from "./pages/M365";
import M365Posture from "./pages/M365Posture";
import M365ItdrSetup from "./pages/setup/M365ItdrSetup";
import SocConsole from "./pages/SocConsole";
import AiActivity from "./pages/AiActivity";
import PartnerDashboard from "./pages/PartnerDashboard";
import PartnerBilling from "./pages/PartnerBilling";
import DistributorDashboard from "./pages/DistributorDashboard";
import DistributorResellers from "./pages/DistributorResellers";
import DistributorBilling from "./pages/DistributorBilling";
import AdminPricing from "./pages/AdminPricing";
import AdminInvoices from "./pages/AdminInvoices";
import AdminAiCosts from "./pages/AdminAiCosts";
import AiAgents from "./pages/AiAgents";
import Hunt from "./pages/Hunt";
import PortalInvoices from "./pages/PortalInvoices";
import SalesKit from "./pages/SalesKit";
import CustomerDashboard from "./pages/CustomerDashboard";
import CustomerEndpoints from "./pages/CustomerEndpoints";
import CustomerThreats from "./pages/CustomerThreats";
import CustomerContact from "./pages/CustomerContact";
import Landed from "./pages/Landed";
import ChannelProgram from "./pages/ChannelProgram";
import ContactSales from "./pages/ContactSales";
import Personal from "./pages/Personal";
import AISoc from "./pages/AISoc";
import PlatformPage from "./pages/PlatformPage";
import ForMsps from "./pages/ForMsps";
import EolWindows from "./pages/EolWindows";
import HomeUserAccount from "./pages/HomeUserAccount";
import HomeUserProtectedRoute from "./components/auth/HomeUserProtectedRoute";
import { RouteAnalytics } from "@/components/analytics/RouteAnalytics";
import { useAuth } from "@/contexts/AuthContext";

function AnalyticsBridge() {
  const { user } = useAuth();
  return <RouteAnalytics isAuthenticated={!!user} />;
}
import AdminHomeUsers from "./pages/AdminHomeUsers";
import DistributorCredits from "./pages/DistributorCredits";
import PartnerCredits from "./pages/PartnerCredits";
import AdminCredits from "./pages/AdminCredits";
import PartnerDeals from "./pages/PartnerDeals";
import DistributorDeals from "./pages/DistributorDeals";
import AdminDeals from "./pages/AdminDeals";
import AdminResellers from "./pages/AdminResellers";
import NotFound from "./pages/NotFound";

import { ErrorBoundary } from "@/components/ErrorBoundary";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <HelmetProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <TenantProvider>
              <AnalyticsBridge />
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/channel-program" element={<ChannelProgram />} />
              <Route path="/contact-sales" element={<ContactSales />} />
              <Route path="/personal" element={<Personal />} />
              <Route path="/ai-soc" element={<AISoc />} />
              <Route path="/platform" element={<PlatformPage />} />
              <Route path="/for-msps" element={<ForMsps />} />
              <Route path="/eol-windows" element={<EolWindows />} />
              <Route
                path="/account"
                element={
                  <HomeUserProtectedRoute>
                    <HomeUserAccount />
                  </HomeUserProtectedRoute>
                }
              />
              <Route path="/blog" element={<BlogIndex />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/security" element={<Security />} />
              <Route path="/acceptable-use" element={<AcceptableUse />} />
              <Route path="/status" element={<Status />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/home"
                element={
                  <ProtectedRoute>
                    <Landed />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/endpoints"
                element={
                  <ProtectedRoute>
                    <Endpoints />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/endpoints/:id"
                element={
                  <ProtectedRoute>
                    <EndpointDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/groups"
                element={
                  <ProtectedRoute>
                    <Groups />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/threats"
                element={
                  <ProtectedRoute>
                    <Threats />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/policies"
                element={
                  <ProtectedRoute>
                    <Policies />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/deploy"
                element={
                  <ProtectedRoute>
                    <AgentDownload />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/logs"
                element={
                  <ProtectedRoute>
                    <EventLogs />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/threat-hunting"
                element={
                  <ProtectedRoute>
                    <ThreatHunting />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/activity"
                element={
                  <ProtectedRoute>
                    <Activity />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminOverview />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/channel"
                element={
                  <ProtectedRoute>
                    <Admin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/health"
                element={
                  <ProtectedRoute>
                    <SystemHealth />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/pricing"
                element={
                  <ProtectedRoute>
                    <AdminPricing />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/invoices"
                element={
                  <ProtectedRoute>
                    <AdminInvoices />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/ai-costs"
                element={
                  <ProtectedRoute>
                    <AdminAiCosts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/agents"
                element={
                  <ProtectedRoute>
                    <AiAgents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/hunt"
                element={
                  <ProtectedRoute>
                    <Hunt />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/home-users"
                element={
                  <ProtectedRoute>
                    <AdminHomeUsers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/credits"
                element={
                  <ProtectedRoute>
                    <AdminCredits />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/distributor/credits"
                element={
                  <DistributorProtectedRoute>
                    <DistributorCredits />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/partner/credits"
                element={
                  <ResellerProtectedRoute>
                    <PartnerCredits />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/partner/deals"
                element={
                  <ResellerProtectedRoute>
                    <PartnerDeals />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/distributor/deals"
                element={
                  <DistributorProtectedRoute>
                    <DistributorDeals />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/admin/deals"
                element={
                  <ProtectedRoute>
                    <AdminDeals />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/resellers"
                element={
                  <ProtectedRoute>
                    <AdminResellers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner/invoices"
                element={
                  <ResellerProtectedRoute>
                    <PortalInvoices tier="partner" />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/distributor/invoices"
                element={
                  <DistributorProtectedRoute>
                    <PortalInvoices tier="distributor" />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/distributor/resources"
                element={
                  <DistributorProtectedRoute>
                    <SalesKit tier="distributor" />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/partner/resources"
                element={
                  <ResellerProtectedRoute>
                    <SalesKit tier="partner" />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/customer"
                element={
                  <CustomerProtectedRoute>
                    <CustomerDashboard />
                  </CustomerProtectedRoute>
                }
              />
              <Route
                path="/customer/endpoints"
                element={
                  <CustomerProtectedRoute>
                    <CustomerEndpoints />
                  </CustomerProtectedRoute>
                }
              />
              <Route
                path="/customer/threats"
                element={
                  <CustomerProtectedRoute>
                    <CustomerThreats />
                  </CustomerProtectedRoute>
                }
              />
              <Route
                path="/customer/contact"
                element={
                  <CustomerProtectedRoute>
                    <CustomerContact />
                  </CustomerProtectedRoute>
                }
              />
              <Route
                path="/customer/reports"
                element={
                  <CustomerProtectedRoute>
                    <CustomerReports />
                  </CustomerProtectedRoute>
                }
              />
              <Route
                path="/my-customers"
                element={
                  <ProtectedRoute>
                    <MyCustomers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites"
                element={
                  <ProtectedRoute>
                    <Sites />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites/:id"
                element={
                  <ProtectedRoute>
                    <SiteDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute>
                    <Users />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/recommendations"
                element={
                  <ProtectedRoute>
                    <Recommendations />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/network"
                element={
                  <ProtectedRoute>
                    <Network />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/microsegmentation"
                element={
                  <ProtectedRoute>
                    <Microsegmentation />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app-whitelisting"
                element={
                  <ProtectedRoute>
                    <AppWhitelisting />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/glossary"
                element={
                  <ProtectedRoute>
                    <Glossary />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/telemetry"
                element={
                  <ProtectedRoute>
                    <Telemetry />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dns-filtering"
                element={
                  <ProtectedRoute>
                    <DnsFiltering />
                  </ProtectedRoute>
                }
              />
              <Route path="/guides" element={<Guides />} />
              <Route
                path="/routers"
                element={
                  <ProtectedRoute>
                    <Routers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedRoute>
                    <Reports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/group-policy"
                element={
                  <ProtectedRoute>
                    <GroupPolicy />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/alerts"
                element={
                  <ProtectedRoute>
                    <Alerts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/incidents"
                element={
                  <ProtectedRoute>
                    <Incidents />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/incidents/:id"
                element={
                  <ProtectedRoute>
                    <IncidentDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/help/sops"
                element={
                  <ProtectedRoute>
                    <HelpSops />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/help/sops/:audience"
                element={
                  <ProtectedRoute>
                    <HelpSops />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/help/sops/:audience/:slug"
                element={
                  <ProtectedRoute>
                    <HelpSops />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/customer-reports"
                element={
                  <ProtectedRoute>
                    <CustomerReports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/legacy-hardening"
                element={
                  <ProtectedRoute>
                    <LegacyHardening />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/vulnerabilities"
                element={
                  <ProtectedRoute>
                    <Vulnerabilities />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/m365"
                element={
                  <ProtectedRoute>
                    <M365 />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/m365/posture"
                element={
                  <ProtectedRoute>
                    <M365Posture />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/soc"
                element={
                  <ProtectedRoute>
                    <SocConsole />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/ai-activity"
                element={
                  <ProtectedRoute>
                    <AiActivity />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/guides/m365-itdr-setup"
                element={
                  <ProtectedRoute>
                    <M365ItdrSetup />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/help"
                element={
                  <ProtectedRoute>
                    <Help />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/partner"
                element={
                  <ResellerProtectedRoute>
                    <PartnerDashboard />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/partner/billing"
                element={
                  <ResellerProtectedRoute>
                    <PartnerBilling />
                  </ResellerProtectedRoute>
                }
              />
              <Route
                path="/distributor"
                element={
                  <DistributorProtectedRoute>
                    <DistributorDashboard />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/distributor/resellers"
                element={
                  <DistributorProtectedRoute>
                    <DistributorResellers />
                  </DistributorProtectedRoute>
                }
              />
              <Route
                path="/distributor/billing"
                element={
                  <DistributorProtectedRoute>
                    <DistributorBilling />
                  </DistributorProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TenantProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </HelmetProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
