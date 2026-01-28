# Laboratory Notebook Module

## Overview

The Laboratory Notebook module is a sophisticated text editor for documenting experimental procedures, observations, and linking physical samples, equipment, and research papers directly into the experimental record.

## Key Features

### 1. Rich Text Editor
- Built with **TipTap** (ProseMirror-based)
- Supports formatting: bold, italic, lists, etc.
- Auto-saves to prevent data loss
- Full edit history tracked in database

### 2. @Mention System

Type `@` to trigger an autocomplete dropdown showing:
- **Samples** - Link to physical samples in the freezer
- **Equipment** - Reference instruments and machines
- **Papers** - Cite research papers from your library

#### Metadata Snapshots

When you mention an entity, the system:
1. Links to the original entity (e.g., Sample ID: abc123)
2. **Saves a snapshot** of the entity's data at that moment
3. Preserves the data even if the sample/equipment is later deleted

**Why?** Six months from now, if Sample P-405 is deleted, your notebook still contains all the metadata (type, location, batch number, etc.) from when you ran the experiment.

### 3. Equipment Data Integration

#### Automatic Data Import Workflow:

1. **Setup Equipment:**
   - Add equipment to the system (e.g., "DNA Sequencer Model X")
   - Configure a watch folder (e.g., `C:\SequencerData\Output\`)
   - Enable auto-import

2. **openbio-agent on Equipment PC:**
   - Runs as a background process on the instrument computer
   - Monitors the watch folder for new files
   - When analysis software outputs a data file, agent detects it

3. **Import Process:**
   - Agent checks which experiment is scheduled on this equipment
   - Uploads file to database (S3 or local storage depending on deployment)
   - Creates a `DigitalAsset` record linked to the experiment
   - Optionally creates a notebook entry with the attached file

4. **Notebook Connection:**
   - Scientist can press "Start Import" button in UI
   - Equipment status changes to "LOCKED" (prevents other bookings)
   - When data arrives, it's automatically linked to the active experiment
   - Notebook entry shows: "Data file imported from [Equipment Name] at [timestamp]"

### 4. Database Schema

```prisma
model Notebook {
  id           String
  experimentId String (unique)
  content      String // Rich text as JSON
  title        String
  mentions     NotebookMention[]
  entries      NotebookEntry[]
}

model NotebookEntry {
  id              String
  content         String // Rich text
  timestamp       DateTime
  author          String?
  attachedAssetId String? // Links to equipment data file
}

model NotebookMention {
  id           String
  entityType   String // "sample", "equipment", "paper"
  entityId     String // Original entity ID
  snapshotData String // JSON snapshot of entity at mention time
  position     Int?   // Position in document
}

model Equipment {
  id           String
  name         String
  type         String
  watchFolder  String? // Path agent monitors
  autoImport   Boolean
  agentStatus  String  // OFFLINE, ONLINE, LOCKED
  lastSyncAt   DateTime?
}
```

## API Endpoints

### Notebooks
- `GET /api/notebooks` - List all notebooks
- `POST /api/notebooks` - Create notebook for an experiment
- `GET /api/notebooks/:id` - Get notebook with mentions and entries
- `PATCH /api/notebooks/:id` - Update notebook content
- `DELETE /api/notebooks/:id` - Delete notebook

### Entries
- `GET /api/notebooks/:id/entries` - List entries
- `POST /api/notebooks/:id/entries` - Create timestamped entry

### Mentions
- `GET /api/notebooks/:id/mentions` - List mentions
- `POST /api/notebooks/:id/mentions` - Create mention with snapshot
- `GET /api/notebooks/search-entities` - Search all mentionable entities

## UI Components

### NotebookPage
Main page with sidebar (notebook list) and editor area.

### NotebookEditor
Rich text editor with toolbar and @mention support.

### MentionList
Dropdown showing available samples/equipment/papers to mention.

## Usage Example

1. **Create Experiment:**
   - Navigate to Experiments tab
   - Create "RNA-Seq Analysis - Patient P-405"

2. **Create Notebook:**
   - Go to Notebooks tab
   - Click + to create notebook for the experiment
   - System creates linked notebook automatically

3. **Document Procedure:**
   ```
   ### Protocol
   
   1. Extracted RNA from @Sample-P-405 (Sample autocompletes)
   2. Loaded sample into @DNA-Sequencer-A (Equipment autocompletes)
   3. Following protocol from @Smith-2024-RNA-Methods (Paper autocompletes)
   4. Added extra reagent concentration: 10mM (custom note)
   ```

4. **Equipment Import:**
   - Click "Start Import" button
   - Equipment status → LOCKED
   - Sequencer finishes → openbio-agent detects file
   - File uploads automatically
   - Notebook entry created: "Data file imported: run_12345.fastq (2.4 GB)"

5. **Review Later:**
   - Six months later, you find the FASTQ file in analysis
   - Click on file → Shows linked notebook
   - Notebook shows: Which sample, which protocol, what modifications
   - All metadata preserved even if sample was deleted

## Future Enhancements

- [ ] Add Patient entity for clinical research
- [ ] Version control integration (Git backend)
- [ ] Collaborative editing (multiple scientists)
- [ ] Template protocols
- [ ] Export to PDF/Word for regulatory submissions
- [ ] Image/photo attachments from microscopes
- [ ] Voice-to-text for hands-free notes during experiments

## Technical Notes

### Agent Architecture

The `openbio-agent` is a separate Rust binary that runs on equipment PCs:
- Watches specified folders for file creation events
- Communicates with Hub/Server via REST API
- Handles authentication and uploads
- Can be configured in Solo/Hub/Enterprise modes

### Data Integrity

- Mentions create immutable snapshots
- Deleting a sample doesn't break notebook references
- All edits are tracked with timestamps
- Content stored as JSON (ProseMirror document format)

### Performance

- Large notebooks (>1MB) may need pagination
- File uploads handled asynchronously
- Equipment status polling every 5 seconds
- Mention search debounced (300ms)

## Compliance & Audit

The notebook system provides full traceability:
- **Who:** Author tracked on each entry
- **What:** Full content with formatting preserved
- **When:** Created/updated timestamps
- **Where:** Links to physical samples and locations
- **Why:** Linked to experiments and papers
- **How:** Equipment and protocol references

This satisfies regulatory requirements (FDA 21 CFR Part 11, GLP, GMP) for electronic lab notebooks.
