import { useAdminDemo } from './useAdminDemo';
import AdminSitePlan from './AdminSitePlan';
import AdminAgentPanel from './AdminAgentPanel';
import { VehicleReviewQueue, ActivityFeed } from './AdminReview';
import NotificationStack from '../resident/Notification';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const demo = useAdminDemo();

  const pendingReview = demo.vehicleQueue.filter(v => v.status === 'pending').length;

  return (
    <div className="admin-dashboard">
      <NotificationStack notifications={demo.notifications} onDismiss={demo.dismissNotif} />

      {/* Page header */}
      <div className="rp-header">
        <div className="rp-header__inner">
          <div>
            <h1 className="rp-header__title">Admin Dashboard</h1>
            <p className="rp-header__sub">Maple Grove Townhomes · Community Manager</p>
          </div>
          <div className="admin-header-right">
            {pendingReview > 0 && (
              <div className="admin-alert-badge" role="alert" aria-live="polite">
                <span aria-hidden="true">⚠</span>
                {pendingReview} vehicle{pendingReview > 1 ? 's' : ''} require review
              </div>
            )}
            <div className="rp-header__badge">
              <span className="rp-header__badge-dot" aria-hidden="true" />
              SpotOn Monitoring
            </div>
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div className="rp-body">
        <main className="rp-left" id="main-content" aria-label="Community site plan — admin view">
          <AdminSitePlan
            spaces={demo.spaces}
            selectedSpace={demo.selectedSpace}
            onSelectSpace={(s) => demo.setSelectedSpace(prev => prev?.id === s?.id ? null : s)}
            waitlistCount={demo.waitlist.length}
            reviewCount={pendingReview}
          />
        </main>

        <aside className="rp-right" aria-label="SpotOn admin agent">
          <AdminAgentPanel
            messages={demo.messages}
            isTyping={demo.isTyping}
            onSend={demo.sendMessage}
            onQuickAction={demo.triggerQuickAction}
          />
        </aside>
      </div>

      {/* Bottom panels */}
      <div className="admin-bottom">
        <VehicleReviewQueue
          vehicles={demo.vehicleQueue}
          onResolve={demo.resolveVehicle}
        />
        <ActivityFeed activity={demo.activity} />
      </div>
    </div>
  );
}
