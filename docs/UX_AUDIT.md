# UX audit: teacher experience (2026-11-04)

Method: walked the teacher journey on the web app, from a new account to selling, at desktop (1280px) and phone (390px) widths, with screenshots of every step.

## What's confusing (by severity)

### 1. No path from "I made a majlis" to "I'm selling"
- After creating a server, the teacher lands in an empty `#عام` chat. Nothing says what to do next.
- Selling depends on four steps in a fixed order (choose a plan → connect Whop → create an offer → mark content paid). Those steps are spread over three places:
  - the ⚙ Settings modal (plan, Whop)
  - a small «العروض» link at the bottom of the sidebar
  - an «اجعلها مدفوعة» button in every channel header
- Nothing shows the order, or which steps are done.
- Doing a step out of order gives an error ("selling needs a paid plan") instead of guidance.

### 2. Money controls in the wrong place
- **«اجعلها مدفوعة 🔒» in every channel header:** one click changes who can see the content. It errors on the free plan, and it's the most prominent button in the header.
- **Settings modal:** personal preferences (language, digits, logout) are mixed with business settings (plan, Whop, sales).

### 3. Channels have no settings
- After creation, a channel can't be renamed or given a topic. Free/paid is only reachable through the header button.
- Text channels and courses are created from two different "+" buttons and two modals.
- There's no "announcements" channel where only the teacher and their team post. That's the most common need for a teacher (requested).

### 4. Course editor: good features, flat design
- **Every control looks the same:** each lesson row has ✏️ ↑ ↓ 🗑️ at the same visual weight. Delete sits right next to reorder, which invites mistakes. Greyed-out arrows look broken.
- **No status at a glance:** you can't see whether a lesson has a video, is a free preview, or has files. A text-only lesson looks the same as an empty one.
- **Settings come before content:** course details (cover, name, description) are the first and biggest block, though they're edited once.
- **Detached actions:** "Add section" is a separate form at the bottom; "Add lesson" is a plain link.
- **Unclear header:** «تم» (done) doesn't say it switches to the student view. Nothing tells you that changes save automatically.

### 5. Offers: one long form
- A single modal with nine fields. Billing type, trial and seat limit are side by side with no explanation.
- The price field has no currency next to it.
- "What it unlocks" is a raw checkbox list.
- There's no preview of what students will see.

### 6. Layout bugs
- **Phone:** the Offers page shows the sidebar and the page side by side, squeezing the content to a third of the screen.
- **Server header:** «دعوة أشخاص» wraps onto two lines.

## What changes
1. **Teacher dashboard** at `/s/<id>/manage`, open to owners and admins. It has:
   - a **setup checklist** with live status: add a course → add lessons → invite students → choose a plan → connect Whop → create an offer. Each step has one button that does it.
   - **Channels:** every channel with its access (free/paid) and who can post.
   - **Selling:** offers and subscribers.

   A new server opens here. The sidebar gets a clear «لوحة المعلم» entry under the server name.
2. **Channel settings dialog** (gear on hover in the sidebar, and in the header): name, topic, who can see it (free/paid, with a plain explanation, and disabled with a link when the plan can't sell), who can post (everyone, or admins only), and delete. The header "make paid" button is removed.
3. **Announcement channels:** `post_policy = staff`.
   - Only the owner and admins can post. Members can read and react, and see «القناة للإعلانات: النشر للمشرفين فقط» instead of the message box (web and mobile).
   - One "New channel" dialog chooses between Chat, Announcements and Course.
4. **Course editor:**
   - Content comes first, and course details move into a collapsible card.
   - Lesson rows show badges (video, text, free preview, files) and keep only a quiet ↑/↓. Edit opens on click; delete moves into the lesson editor.
   - "Add lesson" is a button in each section; "Add section" is a single button that becomes an input.
   - The header button now reads "Student view", with a small "Changes save automatically" note.
5. **Offer editor as three steps:**
   1. What it unlocks: a "whole majlis" card, or pick courses and channels.
   2. Price and billing: a large price field with the currency, and plain sentences for each billing type.
   3. Extras (trial, seat limit) with a live preview card exactly as students see it.
6. **Settings modal split** into "Account" and "Teaching" sections.
7. **Fixes:** the sidebar is hidden on management pages on phones, and the header no longer wraps.
