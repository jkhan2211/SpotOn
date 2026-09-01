import { useResidentDemo } from './useResidentDemo';
import SitePlan from './SitePlan';
import AgentPanel from './AgentPanel';
import NotificationStack from './Notification';
import OfferBanner from './OfferBanner';
import './ResidentPortal.css';

export default function ResidentPortal() {
  const demo = useResidentDemo();
  const resident = demo.residentContext;

  return (
    <div className="resident-portal">
      {/* Notifications */}
      <NotificationStack notifications={demo.notifications} onDismiss={demo.dismissNotif} />

      {/* Page header */}
      <div className="rp-header">
        <div className="rp-header__inner">
          <div>
            <h1 className="rp-header__title">Resident Portal</h1>
            <p className="rp-header__sub">
              {resident ? `${resident.first_name} · Unit ${resident.unit_number}` : 'Tell SpotOn your unit to get started'}
            </p>
          </div>
          <div className="rp-header__actions">
            <div className="rp-header__badge">
              <span className="rp-header__badge-dot" aria-hidden="true" />
              SpotOn Active
            </div>
            {resident && (
              <button className="rp-header__switch" onClick={demo.switchUnit} aria-label="Switch to a different unit">
                Switch Unit
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Waitlist offers awaiting a response */}
      <OfferBanner
        offers={demo.offers}
        onAccept={demo.acceptOffer}
        onDecline={demo.declineOffer}
        offerActionId={demo.offerActionId}
      />

      {/* Main two-column layout */}
      <div className="rp-body">
        <main className="rp-left" id="main-content" aria-label="Community site plan">
          <SitePlan
            spaces={demo.spaces}
            selectedSpace={demo.selectedSpace}
            onSelectSpace={(s) => demo.setSelectedSpace(prev => prev?.id === s?.id ? null : s)}
            activePermits={demo.activePermits}
            onRelease={demo.releasePermit}
            isReleasing={demo.isReleasing}
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
