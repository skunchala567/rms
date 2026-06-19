Build a Progressive Web Application (PWA) named "Stay Back Route Management System" for managing students who stay back after regular school hours and require transport allocation.

## Technology Requirements

* Progressive Web Application (PWA)
* Mobile-friendly and desktop-friendly responsive UI
* Installable on Android, iOS, Windows, and Mac devices
* Offline support for basic viewing
* Modern clean UI with role-based login
* Use local database or lightweight backend (SQLite/MySQL)
* Export functionality in Excel format

## User Roles

### 1. Transport Incharge

Full access to:

* Add/Edit/Delete Students
* Bulk Upload Students
* Manage Buses
* Assign Routes
* Replace Routes
* Send WhatsApp Notifications
* View Reports

### 2. Data Entry User

Access to:

* Add/Edit Students
* Bulk Upload Students
* View Route Allocation
* No Bus Configuration Access
* No WhatsApp Sending Access

---

# Login Module

Fields:

* Username
* Password

Role-based access after login.

---

# Dashboard

Display summary cards:

* Total Students
* Students Awaiting Route Assignment
* Students Assigned for 5 PM Trip
* Total Active Buses
* WhatsApp Messages Sent Today

Quick Actions:

* Add Student
* Bulk Upload Students
* Manage Buses
* Assign Routes
* Send Notifications

---

# Student Management

## Student Master Fields

* Student ID
* Student Name
* Class
* Section
* Category of Drop

  * Stay Back Study Hours
  * Sports
  * IIT/JEE Coaching
  * Cultural Activities
  * Other
* Parent Name
* Parent Mobile Number
* Current Route Number
* Status (Active/Inactive)

### Features

#### Single Student Entry

Form to add one student.

#### Bulk Upload

Upload Excel/CSV with columns:

* Student ID
* Student Name
* Class
* Section
* Category
* Parent Mobile

Show validation errors before import.

### Student Listing Screen

Grid columns:

* Student ID
* Student Name
* Class
* Section
* Category
* Route No
* Assigned Bus
* Status

Features:

* Search
* Filter
* Sort
* Edit
* Bulk Select

---

# 5 PM Trip Assignment

Provide a dedicated screen:

### Student Selection

Allow users to:

* Select multiple students
* Select all students
* Filter by:

  * Class
  * Section
  * Category
  * Route

Button:
"Assign for 5 PM Trip"

Selected students move into today's trip list.

---

# Bus Management

Create Bus Master.

Fields:

* Bus Number
* Route Number
* Seating Capacity
* GPS Tracking Link
* Driver Name
* Driver Mobile Number
* Bus Status (Active/Inactive)

### Bus Listing

Display:

* Bus Number
* Route Number
* Seating Capacity
* Occupied Seats
* Available Seats
* Tracking Link

Show occupancy percentage visually.

---

# Route Assignment Module

Allow assigning students to routes.

Features:

### Manual Assignment

Select Students → Select Route → Save

### Auto Capacity Validation

System should:

* Check seating capacity
* Prevent over-allocation
* Show warning when capacity exceeds limit

### Route Occupancy View

Display:

* Route Number
* Bus Number
* Capacity
* Occupied
* Available

---

# Route Replacement Feature

This is a critical feature.

Scenario:

If Route 10 is changed to Route 15:

System should automatically update all students currently assigned to Route 10.

Workflow:

1. Select Existing Route
2. Select New Route
3. Show affected student count
4. Confirm replacement
5. Update all linked students

Audit Log:

* Old Route
* New Route
* Updated By
* Date & Time

---

# WhatsApp Notification Module

After route verification:

Provide button:

"Send Route Notification"

Workflow:

1. User reviews assigned routes.

2. Click Send Notification.

3. System fetches:

   * Student Name
   * Parent Mobile Number
   * Bus Number
   * Tracking Link

4. Call SmartPing WhatsApp API using CURL.

I will provide the CURL request later.

Use template variables:

* {{student_name}}
* {{bus_number}}
* {{tracking_link}}

Notification Example:

Dear Parent,

Your ward {{student_name}} has been assigned to Bus {{bus_number}} for today's stay-back transport.

Live Tracking:
{{tracking_link}}

Thank you.

### Message Tracking

Maintain logs:

* Student Name
* Mobile Number
* Sent Time
* Status

  * Sent
  * Failed
  * Pending

Allow re-send for failed messages.

---

# Reports

Provide reports:

### Daily Route Report

Columns:

* Student Name
* Student ID
* Route Number
* Bus Number
* Category

### Bus Occupancy Report

Columns:

* Bus Number
* Capacity
* Occupied
* Available

### WhatsApp Delivery Report

Columns:

* Student Name
* Mobile
* Message Status
* Sent Time

Export all reports to Excel.

---

# PWA Features

* Install App button
* Mobile responsive
* Offline caching
* Push notification ready
* Fast loading
* App icon and splash screen

---

# UI Requirements

Use a modern school transport management theme.

Menu:

* Dashboard
* Students
* 5 PM Trips
* Buses
* Route Assignment
* Route Replacement
* Notifications
* Reports
* Users

Provide:

* Clean cards
* Data tables
* Search filters
* Pagination
* Confirmation dialogs
* Success/Error toasts

Generate complete frontend, backend, database schema, API endpoints, role-based authentication, and deployment instructions.