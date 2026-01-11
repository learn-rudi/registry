# Tally Forms Stack

Create, manage, and analyze Tally forms and submissions via the Tally API.

## Features

- 📋 **Form Management** - List, create, update, and delete forms
- 📝 **Field Operations** - List and manage form fields
- 📊 **Submission Handling** - Get, filter, and export form responses
- 🔗 **URL Generation** - Create pre-filled form URLs for multi-step workflows
- 📈 **Analytics** - Get form response counts and metrics

## Installation

```bash
rudi install tally
rudi secrets set TALLY_API_KEY "your_api_key_here"
rudi integrate claude
```

## Getting Your API Key

1. Go to [Tally Developer Docs](https://tally.so/help/api)
2. Enable API access in your account settings
3. Generate an OAuth token
4. Copy the token and add it to RUDI secrets

## Available Tools

### Form Management

#### `tally_list_forms`
List all forms in your account.

```typescript
{
  limit: 50,      // optional: max forms to return
  offset: 0       // optional: pagination offset
}
```

#### `tally_get_form`
Get detailed information about a specific form.

```typescript
{
  form_id: "q4G4l9"  // required: form ID
}
```

#### `tally_create_form`
Create a new Tally form.

```typescript
{
  title: "AI Readiness Survey",  // required
  blocks: [...]                  // optional: form blocks
}
```

#### `tally_update_form`
Update form settings or blocks.

```typescript
{
  form_id: "q4G4l9",            // required
  title: "Updated Title",        // optional
  blocks: [...]                  // optional
}
```

#### `tally_delete_form`
Permanently delete a form.

```typescript
{
  form_id: "q4G4l9"  // required
}
```

### Field Operations

#### `tally_list_fields`
List all fields in a form.

```typescript
{
  form_id: "q4G4l9"  // required
}
```

### Submission Handling

#### `tally_list_submissions`
Get submissions for a form (returns all submissions with questions and responses).

```typescript
{
  form_id: "q4G4l9",              // required
  since: "2024-01-01T00:00:00Z"   // optional: ISO date
}

// Returns:
// {
//   page: 1,
//   limit: 50,
//   hasMore: false,
//   questions: [...],  // All form questions
//   submissions: [     // All submission responses
//     {
//       id: "obL5eBN",
//       submittedAt: "2026-01-11T23:02:21.000Z",
//       isCompleted: true,
//       responses: [...]
//     }
//   ]
// }
```

#### `tally_get_submission`
Get a specific submission by ID.

```typescript
{
  submission_id: "sub_123"  // required
}
```

#### `tally_filter_submissions`
Filter submissions by question answers (searches question titles and answer values).

```typescript
{
  form_id: "q4G4l9",              // required
  filters: {                       // required: key = question title (partial match)
    "Age Range": "65 or older",
    "Frequency": "Daily"
  },
  limit: 100                       // optional
}

// Note: Filters match by question title (case-insensitive partial match)
// and answer value (case-insensitive contains)
```

#### `tally_export_submissions`
Export form submissions to CSV or JSON.

```typescript
{
  form_id: "q4G4l9",  // required
  format: "csv"       // required: "csv" or "json"
}
```

### URL Generation

#### `tally_generate_prefill_url`
Generate a form URL with pre-filled fields.

```typescript
{
  form_id: "q4G4l9",              // required
  prefill_data: {                  // required
    organization: "Acme Corp",
    email: "user@acme.com",
    name: "John Doe",
    role: "Director"
  },
  embed: false                     // optional: use embed URL
}
```

### Analytics

#### `tally_get_analytics`
Get form analytics and metrics.

```typescript
{
  form_id: "q4G4l9"  // required
}
```

## Common Use Cases

### Multi-Step Form Workflow

Create a workflow where users submit a request form, then are redirected to an assessment with pre-filled context:

```typescript
// 1. Get submission from request form
const submission = await tally_get_submission({
  submission_id: "sub_123"
});

// 2. Generate pre-filled assessment URL
const assessmentUrl = await tally_generate_prefill_url({
  form_id: "0Q8QqB",
  prefill_data: {
    organization: submission.fields.organization,
    email: submission.fields.email,
    name: submission.fields.name,
    role: submission.fields.role
  }
});

// 3. Send assessment URL to user
```

### Filter and Export Responses by Organization

```typescript
// Get all responses for specific organization
const responses = await tally_filter_submissions({
  form_id: "0Q8QqB",
  filters: { organization: "Acme Corp" }
});

// Export to CSV
const csv = await tally_export_submissions({
  form_id: "0Q8QqB",
  format: "csv"
});
```

### Form Analytics Dashboard

```typescript
// Get metrics for a form
const analytics = await tally_get_analytics({
  form_id: "q4G4l9"
});

// Returns:
// {
//   form_id: "q4G4l9",
//   form_title: "AI Readiness Request",
//   total_responses: 42,
//   last_response: "2024-01-10T15:30:00Z",
//   form_created: "2024-01-01T00:00:00Z"
// }
```

## Integration Patterns

### With Google Sheets
Export Tally responses and import into Google Sheets for analysis:

```bash
# Using RUDI with both stacks
rudi install tally google-workspace
```

### With Slack
Send notifications when new form submissions arrive:

```bash
# Get latest submissions and notify team
rudi install tally slack
```

### With Notion
Store form responses in a Notion database:

```bash
# Sync submissions to Notion
rudi install tally notion-workspace
```

## API Limitations

- Form creation via API has some limitations compared to UI
- Hidden fields work best when configured in Tally UI
- Some form settings may require manual configuration
- Pre-filling works via URL parameters (no direct API submission creation)

## Resources

- [Tally API Documentation](https://developers.tally.so/)
- [Tally Developer Resources](https://tally.so/help/developer-resources)
- [OAuth Authentication Guide](https://tally.so/help/api)

## Support

For issues or feature requests, visit the [RUDI Registry](https://github.com/learn-rudi/registry).
