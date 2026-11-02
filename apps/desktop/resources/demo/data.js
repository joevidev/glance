// Offline demo data. Today in the demo is Monday 2026-11-02, so "tomorrow" is Tuesday 2026-11-03.
window.EMAILS = [
  { id: 'ana', from: 'Ana Torres', addr: 'ana.torres@northwind.example', time: '9:41', subject: 'Demo tomorrow at 3 PM?',
    preview: 'Hi Joel, can we run the product demo with the team?',
    body: [
      'Hi Joel,',
      'Thanks for walking me through the roadmap on Friday, the whole team is excited about it.',
      { id: 'when', text: 'Can we run the product demo tomorrow, Tuesday, November 3, 2026 at 3:00 PM in the Hudson room?' },
      'Please let me know if that works for you. I will book the room and invite Marcus and Priya as soon as you answer.',
      'Ana' ] },
  { id: 'inv', from: 'Billing', addr: 'billing@cloudfleet.example', time: '9:12', subject: 'Invoice #4821 is ready', preview: 'Amount due 1,240.00 USD, due Friday.',
    body: ['Hello,', 'Invoice #4821 for October is ready. The amount due is 1,240.00 USD, due Friday, November 6.', 'Thank you, CloudFleet Billing'] },
  { id: 'wk', from: 'Team Glance', addr: 'team@glance.example', time: '8:55', subject: 'Weekly update: benchmark numbers are in', preview: 'Click accuracy is up 11 points on the held-out set.',
    body: ['Team,', 'The benchmark numbers are in. Click accuracy is up 11 points on the held-out set and latency is down 30 percent.', 'Details in the shared doc.'] },
  { id: 'sam', from: 'Sam Okafor', addr: 'sam.okafor@example.com', time: '8:20', subject: 'Lunch on Thursday?', preview: 'The new ramen place on Mission opened.',
    body: ['Hey Joel,', 'The new ramen place on Mission opened. Are you free for lunch on Thursday around 12:30?', 'Sam'] },
  { id: 'gh', from: 'GitHub', addr: 'noreply@github.example', time: 'Yesterday', subject: 'Your pull request was merged', preview: 'glance/desktop: gaze overlay polish.',
    body: ['Your pull request "gaze overlay polish" was merged into main.', 'View the repository for the latest changes.'] },
  { id: 'lin', from: 'Lena Fischer', addr: 'lena.fischer@example.com', time: 'Yesterday', subject: 'Travel plans for the offsite', preview: 'Flights are booked for the 18th.',
    body: ['Hi Joel,', 'Flights for the offsite are booked for the 18th. The hotel is two blocks from the venue.', 'Lena'] },
]
window.byId = (id) => window.EMAILS.find((e) => e.id === id) || window.EMAILS[0]
window.param = (k) => new URLSearchParams(location.search).get(k)
window.store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('glance.demo.' + k)) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem('glance.demo.' + k, JSON.stringify(v)) } catch {} },
}
window.nav = (active) => `<header class="top"><b>Mail</b>
  <a class="pill ${active === 'inbox' ? 'on' : ''}" href="index.html">Inbox</a>
  <a class="pill ${active === 'calendar' ? 'on' : ''}" href="calendar.html">Calendar</a></header>`
