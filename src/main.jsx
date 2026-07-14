import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { conversations, slots } from './workflow/fixtures'
import { processConversation } from './workflow/engine'
import { reduceTask } from './workflow/reducer'
import { TASK_STATES } from './workflow/types'
import './styles.css'

const buildTasks = () => Object.fromEntries(conversations.map((conversation) => [conversation.id, processConversation({ taskId: `task-${conversation.id}`, conversationId: conversation.id, messages: conversation.initialMessages || conversation.messages, availability: conversation.id === 'empty' ? [] : slots })]))

function Icon({ name, size = 18 }) {
  const paths = {
    inbox: <><path d="M3 5.5h18v13H3z"/><path d="M3 14h4l2 2h6l2-2h4"/></>, calendar: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 9h18"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .3 2l.1.1-1.7 1.7-.1-.1a1.8 1.8 0 0 0-2-.3 1.8 1.8 0 0 0-1.1 1.7V21h-2.4v-.9a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .3l-.1.1-1.7-1.7.1-.1a1.8 1.8 0 0 0 .3-2 1.8 1.8 0 0 0-1.7-1.1H5V11.5h.9a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.3-2l-.1-.1 1.7-1.7.1.1a1.8 1.8 0 0 0 2 .3 1.8 1.8 0 0 0 1.1-1.7V4h2.4v1.3a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.3l.1-.1 1.7 1.7-.1.1a1.8 1.8 0 0 0-.3 2 1.8 1.8 0 0 0 1.7 1.1h.9V14h-.9a1.8 1.8 0 0 0-1.7 1z"/></>, tag: <><path d="M4 5v5l9 9 6-6-9-9H4z"/><circle cx="8" cy="8" r="1"/></>, check: <><path d="m5 12 4 4L19 6"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>, pin: <><path d="m12 3 3 5-1 4 3 3H7l3-3-1-4 3-5z"/><path d="M12 15v6"/></>, send: <><path d="m3 4 18 8-18 8 4-8-4-8zM7 12h14"/></>, edit: <><path d="m4 17-.7 3.7L7 20l11.5-11.5-3-3-11.5 11.5zM14 6.5l3 3"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Avatar({ person, small = false }) { return <div className={`avatar ${person.tone || 'purple'} ${small ? 'small' : ''}`}>{person.initials}</div> }

function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to sign in')
      onAuthenticated(result.user)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="login-title"><div className="auth-mark">TF</div><p className="auth-eyebrow">TrialFlow operations</p><h1 id="login-title">Sign in to your workspace</h1><p className="auth-copy">Review conversations, approve replies, and manage trial bookings securely.</p><form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/>{error && <p className="auth-error" role="alert">{error}</p>}<button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button></form><p className="auth-footnote">Demo access is controlled by the server environment.</p></section></main>
}

const stateLabel = { [TASK_STATES.NEW]: 'New inquiry detected', [TASK_STATES.COLLECTING_INFO]: 'Collecting missing info', [TASK_STATES.READY_TO_OFFER]: 'Ready to offer slots', [TASK_STATES.AWAITING_CUSTOMER]: 'Awaiting customer reply', [TASK_STATES.READY_FOR_CONFIRMATION]: 'Ready for confirmation', [TASK_STATES.CONFIRMED]: 'Confirmed booking', [TASK_STATES.NEEDS_HUMAN]: 'Needs human review' }
const humanReason = { no_matching_slots: 'No available slots match the customer’s preferences.', low_confidence: 'The message is ambiguous and needs an operator to interpret it.', unsupported_intent: 'This request is outside the trial-booking workflow.', sensitive_or_personalized_request: 'This request needs sensitive, personalized judgment.' }
const stateOrder = [TASK_STATES.NEW, TASK_STATES.COLLECTING_INFO, TASK_STATES.READY_TO_OFFER, TASK_STATES.AWAITING_CUSTOMER, TASK_STATES.READY_FOR_CONFIRMATION, TASK_STATES.CONFIRMED]

function Workspace({ user, onLogout }) {
  const [selected, setSelected] = useState('maya')
  const [tasks, setTasks] = useState(buildTasks)
  const [lastError, setLastError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [filterMode, setFilterMode] = useState('open')
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [mobilePanel, setMobilePanel] = useState('console')
  const current = conversations.find((item) => item.id === selected) || conversations[0]
  const task = tasks[selected]
  const isHuman = task.state === TASK_STATES.NEEDS_HUMAN
  const isMissing = task.state === TASK_STATES.COLLECTING_INFO
  const isConfirmed = task.state === TASK_STATES.CONFIRMED
  const replySent = task.activityLog.some((event) => event.type === 'reply_sent')
  const pendingCount = useMemo(() => Object.values(tasks).filter((item) => ![TASK_STATES.CONFIRMED, TASK_STATES.NEEDS_HUMAN].includes(item.state)).length, [tasks])
  const visibleConversations = useMemo(() => conversations.filter((item) => filterMode === 'all' || (filterMode === 'open' && ![TASK_STATES.CONFIRMED].includes(tasks[item.id].state)) || (filterMode === 'human' && tasks[item.id].state === TASK_STATES.NEEDS_HUMAN)), [filterMode, tasks])
  const selectedSlot = task.suggestedSlots.find((slot) => slot.id === task.selectedSlotId)

  function dispatch(event) {
    const result = reduceTask(tasks[selected], event)
    if (result.error) { setLastError(result.error.message); return }
    setLastError('')
    setTasks((previous) => ({ ...previous, [selected]: result.task }))
  }
  function selectConversation(id) { setSelected(id); setLastError(''); setEditMode(false); setMobilePanel('console') }
  function resetTask() { setTasks((previous) => ({ ...previous, [selected]: buildTasks()[selected] })); setLastError(''); setEditMode(false) }

  return <div className="app-shell">{lastError && <div className="workflow-error" role="alert"><span>{lastError}</span><button onClick={() => setLastError('')}>Dismiss</button><button onClick={resetTask}>Reset task</button></div>}
    <aside className="nav-rail"><div className="brand">TrialFlow</div><nav className="primary-nav" aria-label="Primary navigation"><button className="nav-item active"><Icon name="inbox"/><span>Inbox</span></button><button className="nav-item" onClick={() => setFilterMode('all')}><Icon name="calendar"/><span>Bookings</span></button><button className="nav-item" onClick={() => setFilterMode('open')}><Icon name="clock"/><span>Availability</span></button><button className="nav-item" onClick={() => setFilterMode('human')}><Icon name="settings"/><span>Needs human</span></button></nav><div className="user-card"><div className="user-avatar">AC</div><div><strong>{user?.name || 'Alex Chen'}</strong><span>{user?.role || 'Manager'}</span></div><button className="logout-button" onClick={onLogout}>Sign out</button></div></aside>

    <section className={`inbox-panel ${mobilePanel === 'inbox' ? 'mobile-show' : ''}`}><header className="panel-header"><h1>Inbox</h1><button className="icon-button" aria-label="Filter inbox" onClick={() => setFilterMode(filterMode === 'open' ? 'all' : 'open')}><Icon name="filter"/></button></header><div className="section-label"><span>{filterMode === 'human' ? 'Needs human' : filterMode === 'all' ? 'All tasks' : 'Open tasks'}</span><strong>{filterMode === 'all' ? conversations.length : filterMode === 'human' ? conversations.filter((item) => tasks[item.id].state === TASK_STATES.NEEDS_HUMAN).length : pendingCount}</strong></div><div className="conversation-list">{visibleConversations.length ? visibleConversations.map((item) => { const itemTask = tasks[item.id]; return <button key={item.id} className={`conversation-item ${selected === item.id ? 'selected' : ''} ${itemTask.state === TASK_STATES.NEEDS_HUMAN ? 'human' : ''}`} onClick={() => selectConversation(item.id)}><Avatar person={item} small/><div className="conversation-copy"><div className="conversation-top"><strong>{item.name}</strong><time>{item.time}</time></div><p>{item.preview}</p></div>{item.unread && <span className="unread-dot"/>}{itemTask.state === TASK_STATES.NEEDS_HUMAN && <span className="human-dot">!</span>}</button> }) : <div className="inbox-empty"><strong>No tasks in this view</strong><span>Try another filter or return to open tasks.</span></div>}</div><div className="list-footer"><span>Workflow monitor</span><small>{pendingCount} tasks need attention</small></div></section>

    <main className={`chat-panel ${mobilePanel === 'chat' ? 'mobile-show' : ''}`}><header className="chat-header"><div className="person"><Avatar person={current}/><div><h2>{current.name}</h2><span>WhatsApp</span></div></div><div className="chat-actions"><button className="icon-button"><Icon name="tag"/></button><button className="icon-button"><Icon name="check"/></button><button className="icon-button"><Icon name="more"/></button></div></header><div className="chat-body"><div className="date-pill">Today</div>{[...(current.initialMessages || current.messages), ...(task.sentMessages || [])].map((message) => <div key={message.id} className={`message ${message.direction === 'outbound' ? 'outgoing' : 'incoming'}`}>{message.text}<time>{message.at}{message.direction === 'outbound' ? ' ✓✓' : ''}</time></div>)}{isConfirmed && <div className="message outgoing success">Great! Your trial class is confirmed for {selectedSlot?.date || 'your selected slot'}.<time>10:27 AM ✓✓</time></div>}</div><div className="composer"><button className="icon-button"><Icon name="pin"/></button><span className="composer-input">{replySent ? 'Reply sent to customer' : 'Type a message...'}</span><button className="send-button" onClick={() => dispatch({ type: 'SEND_REPLY' })} disabled={replySent || (isHuman && task.owner !== 'human') || task.draftStatus !== 'approved'}><Icon name="send" size={16}/> {replySent ? 'Sent' : 'Send reply'}</button></div></main>

    <aside className={`inspector ${mobilePanel === 'inspector' ? 'mobile-show' : ''}`}><header className="inspector-header"><div><h2>AI task summary</h2><small className="owner-label">{task.owner === 'human' ? 'Human-owned' : 'AI-owned'}</small></div><span className={`intent ${isHuman ? 'human-intent' : ''}`}>{task.intent === 'new_trial_inquiry' ? 'Trial inquiry' : task.intent}</span></header><div className="progress-title"><strong>{stateLabel[task.state]}</strong><span className="collapse">⌃</span></div><div className="progress-track"><span className="progress-done"/><span className={isMissing ? 'progress-current' : 'progress-done'}/><span className={[TASK_STATES.READY_TO_OFFER, TASK_STATES.AWAITING_CUSTOMER, TASK_STATES.READY_FOR_CONFIRMATION, TASK_STATES.CONFIRMED].includes(task.state) ? 'progress-current' : ''}/><span className={isConfirmed ? 'progress-done' : ''}/><span/></div><div className="state-steps" aria-label="Task state machine">{stateOrder.map((state, index) => <span key={state} className={`${task.state === state ? 'current' : ''} ${stateOrder.indexOf(task.state) > index ? 'complete' : ''}`}>{index + 1}. {stateLabel[state]}</span>)}</div><div className="decision-summary"><div><strong>Why this decision</strong><p>{task.decisionReason}</p></div><span className="confidence">{Math.round(task.confidence * 100)}% confidence</span></div>

      <section className="inspector-section"><div className="section-heading"><h3>Extracted information</h3><button className="text-button" onClick={() => setEditMode(!editMode)} disabled={isConfirmed}><Icon name="edit" size={14}/> {editMode ? 'Done' : 'Edit'}</button></div>{[['Child age', 'childAge', task.extractedFields.childAge || 'Not provided'], ['Location', 'location', task.extractedFields.location || 'Not provided'], ['Timing', 'timing', task.extractedFields.preferredDays?.join(', ') || task.extractedFields.preferredTime || 'Not provided']].map(([label, key, value]) => <div className={`field-row ${value === 'Not provided' ? 'missing-field' : ''}`} key={label}><span>{label}</span>{editMode ? <input defaultValue={value === 'Not provided' ? '' : value} aria-label={label} onBlur={(event) => { const input = event.target.value.trim(); const fields = key === 'childAge' ? { childAge: input ? Number(input) : undefined } : key === 'timing' ? (/^(morning|afternoon|\d{1,2}(?::\d{2})?\s*(?:am|pm))$/i.test(input) ? { preferredDays: undefined, preferredTime: input } : { preferredDays: input ? input.split(',').map((day) => day.trim()).filter(Boolean) : undefined, preferredTime: undefined }) : { [key]: input || undefined }; dispatch({ type: 'UPDATE_FIELDS', fields, availability: current.id === 'empty' ? [] : slots }) }}/> : <strong>{value}</strong>}</div>)}</section>
      {isHuman ? <section className="human-callout"><div className="callout-icon">!</div><div><strong>Human judgment needed</strong><p>{humanReason[task.needsHumanReason] || task.needsHumanReason || 'Review the conversation before replying.'}</p></div><button className="secondary-action takeover-button" onClick={() => dispatch({ type: 'TAKE_OVER' })}>{task.owner === 'human' ? 'Taken over' : 'Take over'}</button></section> : isMissing ? <section className="human-callout missing-callout"><div className="callout-icon">?</div><div><strong>Missing information</strong><p>{task.missingFields.join(', ')} are required before matching slots.</p></div></section> : <section className="inspector-section slots-section"><div className="section-heading"><h3>{task.suggestedSlots.length} matching slots</h3>{task.state === TASK_STATES.READY_TO_OFFER ? <button className="text-button" onClick={() => dispatch({ type: 'DRAFT_SLOT_REPLY' })}>Offer slots</button> : <small>↻ Local availability</small>}</div>{task.suggestedSlots.map((slot) => <button key={slot.id} className={`slot-row ${task.selectedSlotId === slot.id ? 'selected' : ''}`} onClick={() => dispatch({ type: 'CUSTOMER_SELECTED_SLOT', slotId: slot.id })} disabled={task.state !== TASK_STATES.AWAITING_CUSTOMER || isConfirmed}><span className="radio"/><div><strong>{slot.date}</strong><span>{slot.startTime} – {slot.endTime}</span></div><div className="slot-meta"><strong>⌖ {slot.location}</strong><span>Ages {slot.ageMin}–{slot.ageMax}</span><small>{slot.coach} · {slot.capacityRemaining} spot{slot.capacityRemaining === 1 ? '' : 's'} left</small></div></button>)}{!task.suggestedSlots.length && <div className="empty-state">No matching slots were found.</div>}<div className="action-row"><button className="primary-action" onClick={() => dispatch({ type: 'CONFIRM_BOOKING' })} disabled={isConfirmed || !task.selectedSlotId || task.draftStatus !== 'approved'}>{isConfirmed ? 'Booking confirmed' : 'Confirm booking'}</button><button className="secondary-action" onClick={() => dispatch({ type: 'REQUEST_HUMAN_REVIEW' })} disabled={isHuman}>Request human review</button></div></section>}
      <section className="inspector-section draft-section"><div className="section-heading"><h3>Draft reply</h3><span className={task.draftStatus === 'approved' ? 'draft-state approved' : 'draft-state'}>{task.draftStatus === 'approved' ? 'Approved' : task.draftStatus === 'edited' ? 'Edited — re-approval needed' : 'Suggested next action'}</span></div><textarea value={task.draftReply} onChange={(event) => dispatch({ type: 'EDIT_DRAFT', text: event.target.value })} aria-label="Draft reply" disabled={isConfirmed || (isHuman && task.owner !== 'human')}/><div className="draft-actions"><button className="secondary-action" onClick={() => dispatch({ type: 'REJECT_DRAFT' })} disabled={isConfirmed}>Reject</button><button className="primary-action" onClick={() => dispatch({ type: 'APPROVE_DRAFT' })} disabled={task.draftStatus === 'approved' || (isHuman && task.owner !== 'human')}>{task.draftStatus === 'approved' ? 'Reply approved' : 'Approve draft'}</button></div></section>
      <section className="inspector-section activity"><div className="section-heading"><h3>Activity log</h3><button className="text-button" onClick={() => setShowAllActivity(!showAllActivity)}>{showAllActivity ? 'Collapse' : 'View all'}</button></div><div className="activity-list">{task.activityLog.slice(showAllActivity ? 0 : -4).map((event) => <div key={event.id}><span className={`activity-mark ${event.type.includes('human') || event.type.includes('error') ? 'warning' : 'done'}`}>{event.type.includes('human') ? '!' : '✓'}</span><time>{event.at}</time><p>{event.message}</p></div>)}</div></section>
    </aside><div className="mobile-tabs"><button className={mobilePanel === 'inbox' ? 'active' : ''} onClick={() => setMobilePanel('inbox')}>Inbox</button><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}>Conversation</button><button className={mobilePanel === 'inspector' ? 'active' : ''} onClick={() => setMobilePanel('inspector')}>AI task</button></div>
  </div>
}

function App() {
  const [status, setStatus] = useState('loading')
  const [user, setUser] = useState(null)

  useEffect(() => {
    fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        const result = await response.json()
        if (response.ok && result.authenticated) { setUser(result.user); setStatus('authenticated') }
        else setStatus('unauthenticated')
      })
      .catch(() => setStatus('unauthenticated'))
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    setStatus('unauthenticated')
  }

  if (status === 'loading') return <main className="auth-shell"><div className="auth-loading">Checking your session…</div></main>
  if (status === 'unauthenticated') return <LoginScreen onAuthenticated={(nextUser) => { setUser(nextUser); setStatus('authenticated') }}/>
  return <Workspace user={user} onLogout={logout}/>
}

createRoot(document.getElementById('root')).render(<App />)
