import { useResidentDemo } from './useResidentDemo';
import SitePlan from './SitePlan';
import AgentPanel from './AgentPanel';
import NotificationStack from './Notification';
import { CURRENT_RESIDENT } from './residentData';
import './ResidentPortal.css';

export default function ResidentPortal() {
  const demo = useResidentDemo();

  const handleRelease = () => {
    if (demo.activePermit) {
      demo.sendMessage(`${demo.activePermit.visitor} left early.`);
    }
  };

  return (
    <div className="resident-portal">
      {/* Notifications */}
      <NotificationStack notifications={demo.notifications} onDismiss={demo.dismissNotif} />

      {/* Page header */}
      <div className="rp-header">
        <div className="rp-header__inner">
          <div>
            <h1 className="rp-header__title">Resident Portal</h1>
            <p className="rp-header__sub">Unit {CURRENT_RESIDENT.unit} · {CURRENT_RESIDENT.name}</p>
          </div>
          <div className="rp-header__badge">
            <span className="rp-header__badge-dot" aria-hidden="true" />
            SpotOn Active
          </div>
        </div>
      </div>

      {/* Main two-column layout */}
      <div className="rp-body">
        <main className="rp-left" id="main-content" aria-label="Community site plan">
          <SitePlan
            spaces={demo.spaces}
            selectedSpace={demo.selectedSpace}
            onSelectSpace={(s) => demo.setSelectedSpace(prev => prev?.id === s?.id ? null : s)}
            activePermit={demo.activePermit}
            onRelease={handleRelease}
          />
        </main>

        <aside className="rp-right" aria-label="SpotOn agent panel">
          <AgentPanel
            messages={demo.messages}
            isTyping={demo.isTyping}
            onSend={demo.sendMessage}
            onQuickAction={demo.triggerQuickAction}
            onJoinWaitlist={demo.joinWaitlist}
            onRespondNoShow={demo.respondNoShow}
            onSimulateGrace={demo.simulateGraceExpiry}
            onConfirmExtension={demo.confirmExtension}
            onSelectAlt={demo.selectAltTime}
          />
        </aside>
      </div>
    </div>
  );
}
