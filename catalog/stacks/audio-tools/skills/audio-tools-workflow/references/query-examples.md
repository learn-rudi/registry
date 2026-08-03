# Audio Query Examples

Use `audio_query` with read-only SQL by default.

Recent transcripts:

```sql
SELECT date, title, filename
FROM notes
ORDER BY datetime DESC
LIMIT 20;
```

Search transcript text:

```sql
SELECT date, title, snippet(notes_fts, 3, '[', ']', '...', 12) AS match
FROM notes_fts
WHERE notes_fts MATCH 'launch OR workshop'
LIMIT 20;
```

Find action items:

```sql
SELECT n.date, n.title, a.content
FROM action_items a
JOIN notes n ON n.id = a.note_id
ORDER BY n.datetime DESC;
```

Summarize by topic:

```sql
SELECT topics.name, COUNT(*) AS notes
FROM topics
JOIN note_topics ON note_topics.topic_id = topics.id
GROUP BY topics.id
ORDER BY notes DESC;
```

Filter by sentiment:

```sql
SELECT date, title, sentiment, summary
FROM notes
WHERE sentiment = 'mixed'
ORDER BY datetime DESC;
```
