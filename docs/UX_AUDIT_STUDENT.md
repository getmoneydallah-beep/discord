# UX audit: student experience and settings (2026-11-04)

Method: walked the student journey on the web app, at desktop (1280px) and phone (390px) widths, with screenshots of every step: an invite link while logged out → sign up → join → browsing → locked content → a free-preview lesson → settings.

## What's confusing (by severity)

### 1. The invite link loses the invitation
- A logged-out visitor who opens an invite link is sent straight to a generic sign-up form. Nothing shows which majlis they're joining, who runs it, or what's inside.
  - The invite details need a login (`GET /invites/:code`), so the page can't show them.
- After signing up, the student lands on the invite card and has to press "Join" again.
- Sign-up asks for a Latin-only **username** on top of a display name. Most Arabic-speaking students don't have a handle ready, and it's the field most likely to fail validation.

### 2. Joining drops the student into an empty chat
- After joining, the student lands in `#عام` and sees "This is the start of the channel". Nothing says the majlis has courses, an announcements channel, or offers.
- On phones, the channel list is hidden behind ☰, so courses are effectively invisible.
- There's no "home" for a majlis that answers "what's here, what's new, where do I continue?".

### 3. Settings are a teacher's settings
- Every student sees «للمعلمين»: plan & billing, connect Whop, sales. None of that applies to them, and it suggests they have to pay.
- **No profile:** you can't change your display name after signing up.
- **No "My subscriptions":** a student who paid can't see what they bought, until when, or where to cancel.
- **"Leave majlis" is in the global Settings dialog:** a big red button that acts on whichever server is open. It's easy to hit by mistake, and hard to find when you actually want it.
- The settings are a small dialog that's cramped on phones.

### 4. Locked content
- **Offer card squeezed on phones:** the title, description and price are crushed into a narrow column next to the button, wrapping one word per line.
- **Progress on a locked course:** it shows "Completed 0 of 3" and an empty bar for a course the student can't start.
- **Locked lesson page has no context:** it doesn't say which lesson, and doesn't point to the free preview.

### 5. Smaller issues
- The empty `/s` page offers "Create majlis" as the main action; most people arriving there are students.
- A lesson's free-preview badge appears in the outline but not on the lesson page.

## What changes (all done, 2026-11-04)
1. **The invite page works logged out:**
   - `GET /invites/:code` becomes public (name, member count and course count only).
   - The page shows a majlis card with "Create account and join" and "I have an account".
   - After signing up or logging in, the student joins automatically and lands on the majlis home.
2. **Simpler sign-up:** the username becomes optional. If left empty, the server generates one from the email (for example `khalid_4821`).
3. **Majlis home** (`/s/<id>`, «الرئيسية» at the top of the sidebar, where a student lands after joining):
   - a welcome header with name and member count
   - **Continue learning:** each course with a progress bar and one "Start/Continue" button
   - the latest announcement
   - channels to join the conversation
   - offers the student doesn't have yet (web only)
4. **Settings page** (`/s/settings`), replacing the small dialog:
   - **Profile:** display name; username shown read-only.
   - **Preferences:** language, Eastern Arabic digits.
   - **My subscriptions:** every offer the student holds, with the majlis, the status, the source (paid or granted), and the date access started.
   - **Teaching:** only for people who own a majlis or have a plan. Everyone else sees one line: "Want to teach? Start your majlis".
   - **Account:** log out, delete account.
5. **Server menu:** «مغادرة المجلس» moves to a ⋯ menu next to the server name, with a confirmation.
6. **Locked content:**
   - The offer card stacks vertically on phones.
   - A locked course shows no progress.
   - The locked lesson page shows the lesson title and a link to the course's free preview.
