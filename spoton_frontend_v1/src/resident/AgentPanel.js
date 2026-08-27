import { useState, useRef, useEffect } from 'react';
import './AgentPanel.css';

const QUICK_ACTIONS = [
  { key: 'book',    label: '🚗 Book visitor parking' },
  { key: 'release', label: '🔓 Release a space' },
  { key: 'extend',  label: '⏱ Extend a visit' },
  { key: 'temp',    label: '🔧 Temporary parking' },
];

function TypingIndicator() {
  return (
    <div className="msg msg--agent" aria-live="polite" aria-label="SpotOn is typing">
      <div className="msg__bubble msg__bubble--typing">
        <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
      </div>
    </div>
  );
}

function Message({ msg, onJoinWaitlist, onRespondNoShow, onSimulateGrace, onConfirmExtension, onSelectAlt }) {
  const isAgent = msg.role === 'agent';
  return (
    <div className={`msg msg--${msg.role}`}>
      {isAgent && <span className="msg__avatar" aria-hidden="true">S</span>}
      <div className="msg__content">
        <div className={`msg__bubble${msg.processing ? ' msg__bubble--processing' : ''}`}>
          <p>{msg.text}</p>

          {/* Permit card inline */}
          {msg.permitCard && (
            <div className="inline-permit-card">
              <div className="inline-permit-card__row">
                <span className="inline-permit-card__label">Visitor</span>
                <span className="inline-permit-card__val">{msg.permitCard.visitor}</span>
              </div>
              <div className="inline-permit-card__row">
                <span className="inline-permit-card__label">Plate</span>
                <span className="inline-permit-card__val">{msg.permitCard.plate}</span>
              </div>
              <div className="inline-permit-card__row">
                <span className="inline-permit-card__label">Space</span>
                <span className="inline-permit-card__val">{msg.permitCard.space}</span>
              </div>
              <div className="inline-permit-card__row">
                <span className="inline-permit-card__label">Time</span>
                <span className="inline-permit-card__val">{msg.permitCard.from}–{msg.permitCard.until}</span>
              </div>
              <span className="inline-permit-card__status">{msg.permitCard.status}</span>
            </div>
          )}

          {/* Waitlist prompt */}
          {msg.waitlistPrompt && (
            <button className="agent-cta agent-cta--primary" onClick={onJoinWaitlist}>
              Join Waitlist
            </button>
          )}

          {/* No-show prompt */}
          {msg.noshowPrompt && (
            <div className="agent-cta-group">
              <button className="agent-cta agent-cta--primary"  onClick={() => onRespondNoShow('yes')}>Yes</button>
              <button className="agent-cta agent-cta--secondary" onClick={() => onRespondNoShow('no')}>No</button>
              <button className="agent-cta agent-cta--ghost"    onClick={() => onRespondNoShow('notsure')}>Not Sure</button>
            </div>
          )}

          {/* Grace period */}
          {msg.gracePeriod && (
            <button className="agent-cta agent-cta--ghost" onClick={onSimulateGrace}>
              Simulate Grace Period Expiry
            </button>
          )}

          {/* Extension options */}
          {msg.extensionOptions && (
            <div className="agent-cta-group">
              {msg.extensionOptions.map(opt => (
                <button key={opt} className="agent-cta agent-cta--primary" onClick={() => onConfirmExtension(opt)}>
                  Extend to {opt}
                </button>
              ))}
              <button className="agent-cta agent-cta--ghost" onClick={() => onConfirmExtension(null)}>
                Keep current permit
              </button>
            </div>
          )}

          {/* Alternative times */}
          {msg.alternatives && (
            <div className="agent-cta-group">
              {msg.alternatives.map(alt => (
                <button key={alt} className="agent-cta agent-cta--secondary" onClick={() => onSelectAlt(alt)}>
                  {alt}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="msg__ts">{msg.ts}</span>
      </div>
    </div>
  );
}

export default function AgentPanel({
  messages, isTyping,
  onSend, onQuickAction,
  onJoinWaitlist, onRespondNoShow, onSimulateGrace,
  onConfirmExtension, onSelectAlt,
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    const val = input.trim();
    if (!val) return;
    onSend(val);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <section className="agent-panel" aria-label="SpotOn Agent">
      {/* Header */}
      <div className="agent-panel__header">
        <div className="agent-panel__avatar" aria-hidden="true">S</div>
        <div>
          <h2 className="agent-panel__title">SpotOn Agent</h2>
          <p className="agent-panel__status">
            <span className="agent-panel__status-dot" aria-hidden="true" />
            Online · Managing community parking
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="agent-panel__messages" role="log" aria-live="polite" aria-label="Conversation with SpotOn Agent">
        {messages.map(msg => (
          <Message
            key={msg.id}
            msg={msg}
            onJoinWaitlist={onJoinWaitlist}
            onRespondNoShow={onRespondNoShow}
            onSimulateGrace={onSimulateGrace}
            onConfirmExtension={onConfirmExtension}
            onSelectAlt={onSelectAlt}
          />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions */}
      <div className="agent-panel__chips" role="list" aria-label="Quick actions">
        {QUICK_ACTIONS.map(a => (
          <button
            key={a.key}
            className="chip"
            role="listitem"
            onClick={() => onQuickAction(a.key)}
            aria-label={a.label}
          >
            {a.label}
          </button>
        ))}
        <button className="chip chip--demo" onClick={() => onQuickAction('noshow')} aria-label="Demo: no-show reminder">
          🔔 No-show reminder
        </button>
      </div>

      {/* Input */}
      <div className="agent-panel__input-row">
        <label htmlFor="agent-input" className="sr-only">Message SpotOn</label>
        <textarea
          id="agent-input"
          ref={inputRef}
          className="agent-panel__input"
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask SpotOn about visitor or temporary parking..."
          aria-label="Message SpotOn"
        />
        <button
          className="agent-panel__send"
          onClick={handleSend}
          disabled={!input.trim()}
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </section>
  );
}
