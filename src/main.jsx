import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { conversations as fixtureConversations, slots as fixtureSlots } from './workflow/fixtures'
import { processConversation } from './workflow/engine'
import { reduceTask } from './workflow/reducer'
import { TASK_STATES } from './workflow/types'
import { getOperatorGuide } from './workflow/operator-guide'
import { clearSupabaseSessionStorage, isSupabaseConfigured, supabase } from './lib/supabase'
import { isServerBacked, loadWorkspace, nextSimulation, persistTaskChange, startSimulation, understandConversation } from './lib/api'
import './styles.css'

const buildTasks = (conversationData = fixtureConversations, availability = fixtureSlots) => Object.fromEntries(conversationData.map((conversation) => [conversation.id, processConversation({ taskId: `task-${conversation.id}`, conversationId: conversation.id, messages: conversation.initialMessages || conversation.messages, availability: conversation.id === 'empty' ? [] : availability })]))

function Icon({ name, size = 18 }) {
  const paths = {
    inbox: <><path d="M3 5.5h18v13H3z"/><path d="M3 14h4l2 2h6l2-2h4"/></>, calendar: <><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 9h18"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .3 2l.1.1-1.7 1.7-.1-.1a1.8 1.8 0 0 0-2-.3 1.8 1.8 0 0 0-1.1 1.7V21h-2.4v-.9a1.8 1.8 0 0 0-1.1-1.7 1.8 1.8 0 0 0-2 .3l-.1.1-1.7-1.7.1-.1a1.8 1.8 0 0 0 .3-2 1.8 1.8 0 0 0-1.7-1.1H5V11.5h.9a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.3-2l-.1-.1 1.7-1.7.1.1a1.8 1.8 0 0 0 2 .3 1.8 1.8 0 0 0 1.1-1.7V4h2.4v1.3a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.3l.1-.1 1.7 1.7-.1.1a1.8 1.8 0 0 0-.3 2 1.8 1.8 0 0 0 1.7 1.1h.9V14h-.9a1.8 1.8 0 0 0-1.7 1z"/></>, tag: <><path d="M4 5v5l9 9 6-6-9-9H4z"/><circle cx="8" cy="8" r="1"/></>, check: <><path d="m5 12 4 4L19 6"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>, pin: <><path d="m12 3 3 5-1 4 3 3H7l3-3-1-4 3-5z"/><path d="M12 15v6"/></>, send: <><path d="m3 4 18 8-18 8 4-8-4-8zM7 12h14"/></>, edit: <><path d="m4 17-.7 3.7L7 20l11.5-11.5-3-3-11.5 11.5zM14 6.5l3 3"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Avatar({ person, small = false }) { return <div className={`avatar ${person.tone || 'purple'} ${small ? 'small' : ''}`}>{person.initials}</div> }

const humanReason = { no_matching_slots: 'No available slots match the customer’s preferences.', low_confidence: 'The message is ambiguous and needs an operator to interpret it.', unsupported_intent: 'This request is outside the trial-booking workflow.', sensitive_or_personalized_request: 'This request needs sensitive, personalized judgment.' }

function displayTimeInMinutes(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
  if (!match) return Number.MAX_SAFE_INTEGER
  let hour = Number(match[1])
  if (match[3]) {
    hour %= 12
    if (match[3].toUpperCase() === 'PM') hour += 12
  }
  return hour * 60 + Number(match[2])
}

function sortMessages(messages) {
  return messages
    .map((message, index) => {
      const timestamp = message.timestamp ? new Date(message.timestamp).getTime() : Number.NaN
      return { message, index, sortKey: Number.isFinite(timestamp) ? timestamp : displayTimeInMinutes(message.at) }
    })
    .sort((left, right) => left.sortKey - right.sortKey || left.index - right.index)
    .map(({ message }) => message)
}

function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) setError(signInError.message)
    setBusy(false)
  }

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title"><div className="auth-mark">TF</div><span className="auth-kicker">TRIALFLOW OPERATIONS</span><h1 id="auth-title">Sign in to your workspace</h1><p>Review conversations, approve replies, and manage trial bookings securely.</p><form onSubmit={signIn}><label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required/><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/>{error && <div className="auth-error" role="alert">{error}</div>}<button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form><small>Authentication is managed by Supabase.</small></section></main>
}

function App({ user, onSignOut, remoteData }) {
  const [localConversations, setLocalConversations] = useState([])
  const conversationData = [...(remoteData?.conversations ?? fixtureConversations), ...localConversations]
  const availability = remoteData?.slots ?? fixtureSlots
  const [selected, setSelected] = useState(() => conversationData[0]?.id ?? 'maya')
  const [tasks, setTasks] = useState(() => remoteData?.tasks ?? buildTasks(conversationData, availability))
  const [lastError, setLastError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [filterMode, setFilterMode] = useState('open')
  const [showAllActivity, setShowAllActivity] = useState(false)
  const [mobilePanel, setMobilePanel] = useState('console')
  const [signingOut, setSigningOut] = useState(false)
  const [persisting, setPersisting] = useState(false)
  const [simulatorBusy, setSimulatorBusy] = useState(false)
  const [newCustomerSequence, setNewCustomerSequence] = useState(0)
  const [navCollapsed, setNavCollapsed] = useState(false)
  useEffect(() => {
    if (remoteData?.revision) setTasks(remoteData.tasks)
  }, [remoteData?.revision])
  const activeId = tasks[selected] ? selected : conversationData.find((item) => tasks[item.id])?.id
  const current = conversationData.find((item) => item.id === activeId) || conversationData[0]
  const task = tasks[activeId]
  const currentSimulation = remoteData?.simulations?.find((simulation) => simulation.conversation_id === current?.id && !['stopped', 'completed'].includes(simulation.status))
  const pendingCount = useMemo(() => Object.values(tasks).filter((item) => ![TASK_STATES.CONFIRMED, TASK_STATES.NEEDS_HUMAN].includes(item.state)).length, [tasks])
  const visibleConversations = useMemo(() => conversationData.filter((item) => tasks[item.id] && (filterMode === 'all' || (filterMode === 'open' && ![TASK_STATES.CONFIRMED].includes(tasks[item.id].state)) || (filterMode === 'human' && tasks[item.id].state === TASK_STATES.NEEDS_HUMAN))), [conversationData, filterMode, tasks])
  const selectedSlot = task?.suggestedSlots?.find((slot) => slot.id === task.selectedSlotId)
  if (!current || !task) return <main className="auth-shell"><section className="auth-card"><h1>No task available</h1><p>This workspace has no workflow task to display yet.</p></section></main>
  const isHuman = task.state === TASK_STATES.NEEDS_HUMAN
  const isMissing = task.state === TASK_STATES.COLLECTING_INFO
  const isConfirmed = task.state === TASK_STATES.CONFIRMED
  const replySent = task.draftStatus === 'approved' && task.sentMessages.some((message) => message.direction === 'outbound' && message.text === task.draftReply)
  const chatMessages = sortMessages([
    ...(current.initialMessages || current.messages),
    ...(task.sentMessages || []),
    ...(isConfirmed ? [{ id: `confirmation-${task.id}`, direction: 'outbound', text: `Great! Your trial class is confirmed for ${selectedSlot?.date || 'your selected slot'}.`, at: '10:27 AM' }] : []),
  ])
  const operatorGuide = getOperatorGuide(task)
  const availabilitySummary = task.suggestedSlots.length ? `${task.suggestedSlots.length} matching slot${task.suggestedSlots.length === 1 ? '' : 's'}` : isMissing ? 'Waiting for details' : 'No matching slots'
  const nextActionSummary = operatorGuide.actionLabel || operatorGuide.title

  function dispatch(event) {
    if (persisting) return
    const previous = tasks[activeId]
    const result = reduceTask(previous, event)
    if (result.error) { setLastError(result.error.message); return }
    setLastError('')
    setTasks((previousTasks) => ({ ...previousTasks, [activeId]: result.task }))
    if (remoteData?.persistTask) {
      setPersisting(true)
      remoteData.persistTask(result.task, previous, event).then(({ version } = {}) => {
        if (version) setTasks((previousTasks) => ({ ...previousTasks, [activeId]: { ...previousTasks[activeId], version } }))
      }).then(() => event.type === 'SEND_REPLY' ? remoteData.reloadWorkspace?.() : undefined).catch(async (error) => {
        setTasks((previousTasks) => ({ ...previousTasks, [activeId]: previous }))
        try { await remoteData.reloadWorkspace?.() } catch { /* retain the local rollback and visible error */ }
        setLastError(`${error.message} The previous server state was restored.`)
      }).finally(() => setPersisting(false))
    }
  }
  function runGuideAction() {
    if (operatorGuide.action) dispatch({ type: operatorGuide.action })
  }
  function selectConversation(id) { setSelected(id); setLastError(''); setEditMode(false); setMobilePanel('console') }
  async function startCustomerSimulation() {
    if (!remoteData?.token || !current?.customerPhone) return
    setSimulatorBusy(true)
    try {
      const seedMessage = current.messages?.at(-1)?.text || current.initialMessages?.at(-1)?.text || current.preview || ''
      const result = await startSimulation(remoteData.token, {
        id: 'general_service_inquiry',
        customer: {
          name: current.name,
          phone: current.customerPhone,
          style: 'natural, concise, realistic',
          background: `The customer previously wrote: "${seedMessage}". Preserve that request and its important facts throughout the conversation.`,
        },
        goal: `Continue and resolve the customer’s existing request: ${seedMessage}`,
        businessContext: { workflow: 'trial booking', policies: ['Ask for missing booking details instead of changing to an unrelated request.'] },
        maxTurns: 6,
      })
      await nextSimulation(remoteData.token, result.simulation.id)
      await remoteData.reloadWorkspace?.()
    } catch (error) { setLastError(error.message) } finally { setSimulatorBusy(false) }
  }
  async function sendNextCustomerTurn() {
    if (!currentSimulation || !remoteData?.token) return
    setSimulatorBusy(true)
    try { await nextSimulation(remoteData.token, currentSimulation.id, task?.draftReply); await remoteData.reloadWorkspace?.() } catch (error) { setLastError(error.message) } finally { setSimulatorBusy(false) }
  }
  async function addNewCustomer() {
    setSimulatorBusy(true)
    setLastError('')
    const sequence = newCustomerSequence + 1
    setNewCustomerSequence(sequence)
    const name = `New customer ${sequence}`
    const phone = `+659${String(Date.now()).slice(-7)}`
    const firstMessage = 'Hi, I’m looking for a trial class for my 6-year-old near Bedok on Saturday morning.'
    try {
      if (remoteData?.token) {
        const result = await startSimulation(remoteData.token, {
          id: 'new_customer_trial_inquiry',
          customer: { name, phone, style: 'natural, concise, realistic', background: `The customer is new and wants to ask: "${firstMessage}" Preserve those important facts throughout the conversation.` },
          goal: 'Book a trial class for a 6-year-old near Bedok on Saturday morning.',
          businessContext: { workflow: 'trial booking', policies: ['Ask for missing booking details instead of changing to an unrelated request.'] },
          maxTurns: 6,
        })
        await nextSimulation(remoteData.token, result.simulation.id)
        const updated = await remoteData.reloadWorkspace?.()
        if (updated?.conversations?.some((conversation) => conversation.id === result.conversation?.id)) setSelected(result.conversation.id)
      } else {
        const id = `new-customer-${Date.now()}`
        const conversation = { id, name, initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), tone: 'green', time: 'Just now', preview: firstMessage, customerPhone: phone, channel: 'simulator', messages: [{ id: `${id}-1`, direction: 'inbound', text: firstMessage, at: 'Just now' }], initialMessages: [{ id: `${id}-1`, direction: 'inbound', text: firstMessage, at: 'Just now' }] }
        const understanding = await understandConversation(conversation.initialMessages)
        const nextTask = processConversation({ taskId: `task-${id}`, conversationId: id, messages: conversation.initialMessages, availability, understanding })
        setLocalConversations((previous) => [...previous, conversation])
        setTasks((previous) => ({ ...previous, [id]: nextTask }))
        setSelected(id)
      }
    } catch (error) { setLastError(error.message) } finally { setSimulatorBusy(false) }
  }
  function resetTask() { if (remoteData?.reloadWorkspace) return remoteData.reloadWorkspace(); setTasks((previous) => ({ ...previous, [activeId]: buildTasks(conversationData, availability)[activeId] })); setLastError(''); setEditMode(false) }
  async function handleSignOut() {
    setSigningOut(true)
    clearSupabaseSessionStorage()
    const timeout = new Promise((resolve) => setTimeout(resolve, 1500))
    try { await Promise.race([Promise.resolve(onSignOut()).catch(() => undefined), timeout]) } finally {
      clearSupabaseSessionStorage()
      window.location.replace('/')
    }
  }

  return <div className="app-shell">{lastError && <div className="workflow-error" role="alert"><span>{lastError}</span><button onClick={() => setLastError('')}>Dismiss</button><button onClick={resetTask}>Reset task</button></div>}<button className="new-customer-fab" onClick={addNewCustomer} disabled={simulatorBusy} aria-label="Add a new AI customer">{simulatorBusy ? 'Starting…' : '+ New AI customer'}</button>
    <aside className={`nav-rail ${navCollapsed ? 'collapsed' : ''}`}><div className="brand-row"><div className="brand">{navCollapsed ? 'TF' : 'TrialFlow'}</div><button type="button" className="nav-toggle" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setNavCollapsed((value) => !value)}>{navCollapsed ? '›' : '‹'}</button></div><nav className="primary-nav" aria-label="Primary navigation"><button className="nav-item active" title="Inbox"><Icon name="inbox"/><span>Inbox</span></button><button className="nav-item" title="Bookings" onClick={() => setFilterMode('all')}><Icon name="calendar"/><span>Bookings</span></button><button className="nav-item" title="Availability" onClick={() => setFilterMode('open')}><Icon name="clock"/><span>Availability</span></button><button className="nav-item" title="Needs human" onClick={() => setFilterMode('human')}><Icon name="settings"/><span>Needs human</span></button></nav><div className="user-card"><div className="user-avatar">{user?.email?.slice(0, 2).toUpperCase() || 'AC'}</div><div className="user-details"><strong>{user?.user_metadata?.full_name || user?.email || 'Alex Chen'}</strong><span>Manager</span></div>{user ? <button type="button" className="sign-out-button" aria-label="Sign out of TrialFlow" onClick={handleSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button> : <span className="chevron">⌄</span>}</div></aside>

    <section className={`inbox-panel ${mobilePanel === 'inbox' ? 'mobile-show' : ''}`}><header className="panel-header"><h1>Inbox</h1><button className="icon-button" aria-label="Filter inbox" onClick={() => setFilterMode(filterMode === 'open' ? 'all' : 'open')}><Icon name="filter"/></button></header><div className="section-label"><span>{filterMode === 'human' ? 'Needs human' : filterMode === 'all' ? 'All tasks' : 'Open tasks'}</span><strong>{filterMode === 'all' ? conversationData.length : filterMode === 'human' ? conversationData.filter((item) => tasks[item.id]?.state === TASK_STATES.NEEDS_HUMAN).length : pendingCount}</strong></div><div className="conversation-list">{visibleConversations.length ? visibleConversations.map((item) => { const itemTask = tasks[item.id]; return <button key={item.id} className={`conversation-item ${selected === item.id ? 'selected' : ''} ${itemTask.state === TASK_STATES.NEEDS_HUMAN ? 'human' : ''}`} onClick={() => selectConversation(item.id)}><Avatar person={item} small/><div className="conversation-copy"><div className="conversation-top"><strong>{item.name}</strong><time>{item.time}</time></div><p>{item.preview}</p></div>{item.unread && <span className="unread-dot"/>}{itemTask.state === TASK_STATES.NEEDS_HUMAN && <span className="human-dot">!</span>}</button> }) : <div className="inbox-empty"><strong>No tasks in this view</strong><span>Try another filter or return to open tasks.</span></div>}</div><div className="list-footer"><span>Workflow monitor</span><small>{pendingCount} tasks need attention</small></div></section>

    <main className={`chat-panel ${mobilePanel === 'chat' ? 'mobile-show' : ''}`}><header className="chat-header"><div className="person"><Avatar person={current}/><div><h2>{current.name}</h2><span>{current.channel === 'simulator' ? 'Simulator' : 'WhatsApp'}</span></div></div><div className="chat-actions">{remoteData?.token && current?.customerPhone && <button className="secondary-action simulator-button" onClick={currentSimulation ? sendNextCustomerTurn : startCustomerSimulation} disabled={simulatorBusy}>{simulatorBusy ? 'Thinking…' : currentSimulation ? 'Next customer turn' : 'Start AI customer'}</button>}<button className="icon-button"><Icon name="tag"/></button><button className="icon-button"><Icon name="check"/></button><button className="icon-button"><Icon name="more"/></button></div></header><div className="chat-body"><div className="date-pill">Today</div>{chatMessages.map((message) => <div key={message.id} className={`message ${message.direction === 'outbound' ? 'outgoing' : 'incoming'} ${String(message.id).startsWith('confirmation-') ? 'success' : ''}`}>{message.text}<time>{message.at}{message.direction === 'outbound' ? ' ✓✓' : ''}</time></div>)}</div><div className="composer"><button className="icon-button"><Icon name="pin"/></button><span className="composer-input">{replySent ? 'Reply sent to customer' : 'Type a message...'}</span><button className="send-button" onClick={() => dispatch({ type: 'SEND_REPLY' })} disabled={replySent || (isHuman && task.owner !== 'human') || task.draftStatus !== 'approved'}><Icon name="send" size={16}/> {replySent ? 'Sent' : 'Send reply'}</button></div></main>

    <aside className={`inspector ${mobilePanel === 'inspector' ? 'mobile-show' : ''}`}><header className="inspector-header"><div><h2>AI task summary</h2><small className="owner-label">{task.owner === 'human' ? 'Human-owned' : 'AI-owned'}</small></div><span className={`intent ${isHuman ? 'human-intent' : ''}`}>{task.intent === 'new_trial_inquiry' ? 'Trial inquiry' : task.intent}</span></header><section className={`at-a-glance ${operatorGuide.tone}`} aria-labelledby="at-a-glance-title"><div className="at-a-glance-heading"><strong id="at-a-glance-title">At a glance</strong><span>Availability and next step</span></div><div className="glance-item"><span>Availability</span><strong>{availabilitySummary}</strong></div><div className="glance-item next"><span>Next action</span><div><strong>{nextActionSummary}</strong>{operatorGuide.action && <button className="primary-action glance-action" onClick={runGuideAction} disabled={persisting}>{operatorGuide.actionLabel}</button>}</div></div></section>

      <section className="inspector-section"><div className="section-heading"><h3>Extracted information</h3><button className="text-button" onClick={() => setEditMode(!editMode)} disabled={isConfirmed}><Icon name="edit" size={14}/> {editMode ? 'Done' : 'Edit'}</button></div>{[['Child age', 'childAge', task.extractedFields.childAge || 'Not provided'], ['Location', 'location', task.extractedFields.location || 'Not provided'], ['Timing', 'timing', task.extractedFields.preferredDays?.join(', ') || task.extractedFields.preferredTime || 'Not provided']].map(([label, key, value]) => <div className={`field-row ${value === 'Not provided' ? 'missing-field' : ''}`} key={label}><span>{label}</span>{editMode ? <input defaultValue={value === 'Not provided' ? '' : value} aria-label={label} onBlur={(event) => { const input = event.target.value.trim(); const fields = key === 'childAge' ? { childAge: input ? Number(input) : undefined } : key === 'timing' ? (/^(morning|afternoon|\d{1,2}(?::\d{2})?\s*(?:am|pm))$/i.test(input) ? { preferredDays: undefined, preferredTime: input } : { preferredDays: input ? input.split(',').map((day) => day.trim()).filter(Boolean) : undefined, preferredTime: undefined }) : { [key]: input || undefined }; dispatch({ type: 'UPDATE_FIELDS', fields, availability }) }}/> : <strong>{value}</strong>}</div>)}</section>
      {isHuman ? <section className="human-callout"><div className="callout-icon">!</div><div><strong>Human judgment needed</strong><p>{humanReason[task.needsHumanReason] || task.needsHumanReason || 'Review the conversation before replying.'}</p></div><button className="secondary-action takeover-button" onClick={() => dispatch({ type: 'TAKE_OVER' })}>Take over task</button></section> : isMissing ? <section className="human-callout missing-callout"><div className="callout-icon">?</div><div><strong>Missing information</strong><p>{task.missingFields.join(', ')} are required before matching slots.</p></div></section> : <section className="inspector-section slots-section"><div className="section-heading"><h3>{task.suggestedSlots.length} matching slots</h3>{task.state === TASK_STATES.READY_TO_OFFER ? <small>Use the next-action button above</small> : task.state === TASK_STATES.AWAITING_CUSTOMER ? <small>Parent chooses a slot</small> : <small>↻ Local availability</small>}</div>{task.suggestedSlots.map((slot) => <button key={slot.id} className={`slot-row ${task.selectedSlotId === slot.id ? 'selected' : ''} ${task.state === TASK_STATES.AWAITING_CUSTOMER ? 'read-only' : ''}`} onClick={() => dispatch({ type: 'CUSTOMER_SELECTED_SLOT', slotId: slot.id })} disabled={true}><span className="radio"/><div><strong>{slot.date}</strong><span>{slot.startTime} – {slot.endTime}</span></div><div className="slot-meta"><strong>⌖ {slot.location}</strong><span>Ages {slot.ageMin}–{slot.ageMax}</span><small>{slot.coach} · {slot.capacityRemaining} spot{slot.capacityRemaining === 1 ? '' : 's'} left</small></div></button>)}{!task.suggestedSlots.length && <div className="empty-state">No matching slots were found.</div>}<div className="action-row"><button className="primary-action" onClick={() => dispatch({ type: 'CONFIRM_BOOKING' })} disabled={isConfirmed || !task.selectedSlotId || task.draftStatus !== 'approved'}>{isConfirmed ? 'Booking confirmed' : 'Confirm booking'}</button><button className="secondary-action" onClick={() => dispatch({ type: 'REQUEST_HUMAN_REVIEW' })} disabled={isHuman}>Escalate to human</button></div></section>}
      <section className="inspector-section draft-section"><div className="section-heading"><h3>Draft reply</h3><span className={task.draftStatus === 'approved' ? 'draft-state approved' : 'draft-state'}>{task.draftStatus === 'approved' ? 'Approved' : task.draftStatus === 'edited' ? 'Edited — re-approval needed' : 'Suggested next action'}</span></div><textarea value={task.draftReply} onChange={(event) => dispatch({ type: 'EDIT_DRAFT', text: event.target.value })} aria-label="Draft reply" disabled={isConfirmed || (isHuman && task.owner !== 'human')}/><div className="draft-actions"><button className="primary-action" onClick={() => dispatch({ type: 'APPROVE_DRAFT' })} disabled={task.draftStatus === 'approved' || (isHuman && task.owner !== 'human')}>{task.draftStatus === 'approved' ? 'Reply approved' : 'Approve draft'}</button></div></section>
      <section className="inspector-section activity"><div className="section-heading"><h3>Activity log</h3><button className="text-button" onClick={() => setShowAllActivity(!showAllActivity)}>{showAllActivity ? 'Collapse' : 'View all'}</button></div><div className="activity-list">{task.activityLog.slice(showAllActivity ? 0 : -4).map((event) => <div key={event.id}><span className={`activity-mark ${event.type.includes('human') || event.type.includes('error') ? 'warning' : 'done'}`}>{event.type.includes('human') ? '!' : '✓'}</span><time>{event.at}</time><p>{event.message}</p></div>)}</div></section>
    </aside><div className="mobile-tabs"><button className={mobilePanel === 'inbox' ? 'active' : ''} onClick={() => setMobilePanel('inbox')}>Inbox</button><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}>Conversation</button><button className={mobilePanel === 'inspector' ? 'active' : ''} onClick={() => setMobilePanel('inspector')}>AI task</button></div>
  </div>
}

function Root() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return undefined
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) { setSession(data.session); setAuthReady(true) }
    }).catch(() => {
      if (mounted) { setSession(null); setAuthReady(true) }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  const [remoteData, setRemoteData] = useState(null)
  const [workspaceError, setWorkspaceError] = useState('')

  async function refreshWorkspace() {
    if (!session) return
    const data = await loadWorkspace(session.access_token)
    setRemoteData({ ...data, token: session.access_token, revision: Date.now(), reloadWorkspace: refreshWorkspace, persistTask: (task, previous, event) => persistTaskChange(session.access_token, task, previous, event) })
    return data
  }

  useEffect(() => {
    if (!session || !isServerBacked) return undefined
    let mounted = true
    refreshWorkspace().catch((error) => { if (mounted) setWorkspaceError(error.message) })
    return () => { mounted = false }
  }, [session])

  async function signOut() {
    let signOutError
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      signOutError = error
    } finally {
      clearSupabaseSessionStorage()
      setSession(null)
    }
    if (signOutError) throw signOutError
  }

  if (!authReady) return <main className="auth-shell"><section className="auth-card auth-loading"><div className="auth-mark">TF</div><p>Checking your session…</p></section></main>
  if (isSupabaseConfigured && !isServerBacked) return <main className="auth-shell"><section className="auth-card"><h1>Workspace configuration required</h1><p>Set VITE_SUPABASE_WORKSPACE_ID before using authenticated mode.</p></section></main>
  if (isSupabaseConfigured && !session) return <AuthScreen />
  if (isServerBacked && session && workspaceError) return <main className="auth-shell"><section className="auth-card"><h1>Workspace unavailable</h1><p role="alert">{workspaceError}</p><button className="auth-submit" onClick={() => window.location.reload()}>Retry</button></section></main>
  if (isServerBacked && session && !remoteData) return <main className="auth-shell"><section className="auth-card auth-loading"><div className="auth-mark">TF</div><p>Loading your workspace…</p></section></main>
  return <App user={session?.user} onSignOut={signOut} remoteData={remoteData} />
}

createRoot(document.getElementById('root')).render(<Root />)
