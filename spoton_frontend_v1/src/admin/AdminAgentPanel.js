import { useState, useRef, useEffect } from 'react';
import '../resident/AgentPanel.css';

const QUICK_ACTIONS = [
  { key: 'vehicles', label: '⚠ Review unknown vehicles' },
  { key: 'capacity', label: '🅿 Show current capacity'  },
  { key: 'waitlist', label: '⏳ Show waitlist'           },
  { key: 'activity', label: '📋 Recent agent actions'   },
  { key: 'policy',   label: '📄 Review parking policy'  },
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

function Message({ msg }) {
  const isAgent = msg.role === 'agent';
  return (
    <div className={`msg msg--${msg.role === 'admin' ? 'resident' : 'agent'}`}>
      {isAgent && <span className="msg__avatar" aria-hidden="true">S</span>}
      <div className="msg__content">
        <div className={`msg__bubble${msg.processing ? ' msg__bubble--processing' : ''}`}>
          <p>{msg.text}</p>

          {/* Inline info card (vehicle match) */}
          {msg.infoCard && (
            <div className="inline-permit-card">
              {Object.entries({ Plate: msg.infoCard.plate, Unit: msg.infoCard.unit, Permit: msg.infoCard.permit, Space: msg.infoCard.space, Until: msg.infoCard.until })
                .filter(([,v]) => v)
                .map(([k,v]) => (
                  <div key={k} className="inline-permit-card__row">
                    <span className="inline-permit-card__label">{k}</span>
                    <span className="inline-permit-card__val">{v}</span>
                  </div>
                ))}
              <span className="inline-permit-card__status">✓ Permit Verified</span>
            </div>
          )}

          {/* Waitlist data */}
          {msg.waitlistData && (
            <div className="admin-msg-list">
              {msg.waitlistData.map(w => (
                <div key={w.id} className="admin-msg-list__item">
                  <span className="admin-msg-list__id">{w.id}</span>
                  <span>Unit {w.unit} · {w.from}–{w.until}</span>
                  <span className="admin-msg-list__status">{w.status}</span>
                </div>
              ))}
            </div>
          )}

          {/* Activity feed */}
          {msg.activityFeed && (
            <div className="admin-msg-list">
              {msg.activityFeed.map((a, i) => (
                <div key={i} className="admin-msg-list__item admin-msg-list__item--activity">
                  <span className="admin-msg-list__ts">{a.ts}</span>
                  <span>{a.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Policy card */}
          {msg.policyCard && (
            <div className="admin-policy-card">
              <span className="admin-policy-card__label">Community Policy</span>
              <p className="admin-policy-card__text">{msg.policyCard.text}</p>
            </div>
          )}
        </div>
        <span className="msg__ts">{msg.ts}</span>
      </div>
    </div>
  );
}

export default function AdminAgentPanel({ messages, isTyping, onSend, onQuickAction }) {
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
    <section className="agent-panel" aria-label="SpotOn Admin Agent">
      <div className="agent-panel__header">
        <div className="agent-panel__avatar" aria-hidden="true">S</div>
        <div>
          <h2 className="agent-panel__title">SpotOn Admin Agent</h2>
          <p className="agent-panel__status">
            <span className="agent-panel__status-dot" aria-hidden="true" />
            Online · Monitoring community parking
          </p>
        </div>
      </div>

      <div className="agent-panel__messages" role="log" aria-live="polite" aria-label="Admin agent conversation">
        {messages.map(msg => <Message key={msg.id} msg={msg} />)}
        {isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      <div className="agent-panel__chips" role="list" aria-label="Quick actions">
        {QUICK_ACTIONS.map(a => (
          <button key={a.key} className="chip" role="listitem"
            onClick={() => onQuickAction(a.key)} aria-label={a.label}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="agent-panel__input-row">
        <label htmlFor="admin-agent-input" className="sr-only">Message SpotOn Admin Agent</label>
        <textarea
          id="admin-agent-input"
          ref={inputRef}
          className="agent-panel__input"
          rows={2}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask SpotOn about parking activity, vehicles, or policy..."
          aria-label="Message SpotOn Admin Agent"
        />
        <button className="agent-panel__send" onClick={handleSend}
          disabled={!input.trim()} aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </section>
  );
}
