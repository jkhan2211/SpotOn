import './Notification.css';

const TYPE_META = {
  success:  { icon: '✓', label: 'Success'     },
  info:     { icon: 'ℹ', label: 'Info'        },
  released: { icon: '↩', label: 'Released'    },
  reminder: { icon: '🔔', label: 'Reminder'   },
};

function Toast({ notif, onDismiss }) {
  const meta = TYPE_META[notif.type] || TYPE_META.info;
  return (
    <div
      className={`toast toast--${notif.type}`}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className="toast__icon" aria-hidden="true">{meta.icon}</span>
      <div className="toast__body">
        <strong className="toast__title">{notif.title}</strong>
        {notif.body && <p className="toast__text">{notif.body}</p>}
      </div>
      <button
        className="toast__close"
        onClick={() => onDismiss(notif.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export default function NotificationStack({ notifications, onDismiss }) {
  if (!notifications.length) return null;
  return (
    <div className="notif-stack" aria-label="Notifications" role="region">
      {notifications.map(n => (
        <Toast key={n.id} notif={n} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
