# Email Templates

This directory contains reusable email templates for common workflows.

## Available Templates

### 1. Follow-up Template
**File**: [followup_template.md](followup_template.md)

Use for following up on conversations, meetings, or previous emails.

**Usage**:
```bash
# Copy template to drafts
cp templates/followup_template.md drafts/rachel_followup.md

# Edit the file
nano drafts/rachel_followup.md

# Send
python workflows/send_from_file.py drafts/rachel_followup.md
```

---

### 2. Partnership Template
**File**: [partnership_template.md](partnership_template.md)

Use for proposing partnerships, collaborations, or business opportunities.

**Usage**:
```bash
cp templates/partnership_template.md drafts/partnership_proposal.md
nano drafts/partnership_proposal.md
python workflows/send_from_file.py drafts/partnership_proposal.md
```

---

### 3. Quick Update Template
**File**: [quick_update_template.md](quick_update_template.md)

Use for sending status updates, progress reports, or quick summaries.

**Usage**:
```bash
cp templates/quick_update_template.md drafts/project_update.md
nano drafts/project_update.md
python workflows/send_from_file.py drafts/project_update.md
```

---

### 4. Introduction Template
**File**: [introduction_template.md](introduction_template.md)

Use for following up after meeting someone at an event or networking.

**Usage**:
```bash
cp templates/introduction_template.md drafts/afrotech_followup.md
nano drafts/afrotech_followup.md
python workflows/send_from_file.py drafts/afrotech_followup.md
```

---

## Template Format

All templates use YAML frontmatter for metadata:

```markdown
---
to: CONTACT_NAME
subject: Your Subject Here
cc: optional@example.com
---

Email body here...
```

### Fields to Replace

When using a template, replace these placeholders:
- `CONTACT_NAME` - Name or email from your CRM
- `[NAME]` - Person's first name
- `[TOPIC]` - Subject matter
- `[EVENT]` - Event name
- `[COMPANY]` - Company name
- `[YOUR ORGANIZATION]` - Your organization name
- `[ADD YOUR MESSAGE]` - Your custom content

---

## Creating Custom Templates

1. Create a new file in `templates/` directory
2. Add frontmatter at the top
3. Use placeholders in square brackets `[PLACEHOLDER]`
4. Save with `.md` extension

**Example**:

```markdown
---
to: CONTACT_NAME
subject: [YOUR SUBJECT]
---

Hi [NAME],

[YOUR MESSAGE HERE]

Best,
Brandon
```

---

## Tips

### 1. Organize by Purpose
Create templates for different purposes:
- `event_followup_template.md`
- `meeting_request_template.md`
- `thank_you_template.md`
- `status_update_template.md`

### 2. Use Descriptive Names
Name templates clearly so you can find them easily:
- ✅ `partnership_proposal_template.md`
- ❌ `template1.md`

### 3. Keep Them Generic
Templates should be generic enough to reuse but specific enough to be useful.

### 4. Version Your Templates
If you update a template significantly, save the old version:
- `followup_template_v1.md`
- `followup_template_v2.md`

---

## Workflow

1. **Select Template**: Choose the appropriate template for your email
2. **Copy to Drafts**: Copy template to `drafts/` directory
3. **Customize**: Replace placeholders with actual content
4. **Update Frontmatter**: Set the correct recipient and subject
5. **Send**: Use `send_from_file.py` to send the email

**Example Complete Workflow**:

```bash
# 1. Copy template
cp templates/followup_template.md drafts/rachel_afrotech.md

# 2. Edit (replace CONTACT_NAME with "rachel", fill in content)
nano drafts/rachel_afrotech.md

# 3. Send
python workflows/send_from_file.py drafts/rachel_afrotech.md
```

Your final file might look like:

```markdown
---
to: rachel
subject: Following Up - AfroTech AI Training Discussion
---

Hi Rachel,

I hope this email finds you well! I wanted to follow up on our conversation at AfroTech about AI training initiatives.

I've been thinking more about how we could collaborate on the workforce transformation program you mentioned. I'd love to share some ideas on how RUDI's AI education platform could complement Crowe's training efforts.

Would you be available for a quick call next week to discuss further?

Looking forward to hearing from you!

Best regards,
Brandon
```

---

## HTML Templates

You can also create HTML templates for richer formatting:

**File**: `templates/newsletter_template.html`

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; }
        .header { background: #007bff; color: white; padding: 20px; }
        .content { padding: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>[NEWSLETTER TITLE]</h1>
    </div>
    <div class="content">
        <p>Hi [NAME],</p>
        <p>[YOUR CONTENT]</p>
    </div>
</body>
</html>
```

**Send HTML**:
```bash
python workflows/send_from_file.py templates/newsletter.html --to "contact" --html
```

---

## See Also

- [WORKFLOWS.md](../WORKFLOWS.md) - Main workflow documentation
- [README.md](../README.md) - Technical API documentation
- [../drafts/](../drafts/) - Where to save customized emails
