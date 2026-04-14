
## Plan

### 1. NJC Supplies Fixes
- Fix bulk export so all selected/marked reports export together
- Optimize invoice editing flow (better form handling, inline editing)

### 2. Database Changes (Migration)
- Add `hr` to `app_role` enum
- Create `notifications` table (id, user_id, title, message, type, read, related_id, created_at)
- Add RLS: users can view/update their own notifications
- Update staff_profiles RLS: HR can view/update all staff except salary column; staff with linked auth accounts can view/update their own profile (except salary)

### 3. HR Role Implementation
- Update `useRoles.tsx` to include `isHR` flag
- HR users can access Staff Profiles page (view all, edit all except salary field)
- Salary field hidden/disabled for HR role in staff edit forms

### 4. Staff Self-Service
- Link staff profiles to auth accounts via `email_address` matching or a new `linked_user_id` column
- Staff can view their own profile on a "My Profile" page
- Staff can update their own details (except salary, position, department)

### 5. In-App Notifications
- Create notification bell component in header
- When payroll is marked as paid, insert notification for the staff member
- Notification dropdown showing unread/read notifications
- Mark as read functionality

### 6. Sidebar/Navigation Updates
- Show/hide menu items based on role (HR sees Staff Profiles, staff sees My Profile)
- Add notification bell to header
