# Laboratory Notebook - Quick Start Guide

## 🎯 What is the Laboratory Notebook?

The Laboratory Notebook is a digital lab notebook that automatically preserves the complete experimental context by linking samples, equipment, and research papers directly into your notes.

## 🚀 Getting Started

### Step 1: Create an Experiment

Before you can create a notebook, you need an experiment to attach it to.

1. Navigate to the **Experiments** tab
2. Click **"+ New Experiment"**
3. Fill in:
   - Name: e.g., "RNA-Seq Analysis - Patient P-405"
   - Description: Brief overview
   - Status: DRAFT
4. Click **Create**

### Step 2: Create a Notebook

1. Navigate to the **Notebooks** tab
2. Click the **"+"** button in the sidebar
3. Select your experiment from the dropdown
4. A new notebook is created automatically

### Step 3: Document Your Work

Click on your new notebook to open the editor. You'll see a rich text editor with formatting tools:

```
📝 Formatting Toolbar:
[B] Bold
[I] Italic
[•] Bullet List
[1.] Numbered List
[↶] Undo
[↷] Redo
```

### Step 4: Use @Mentions

This is where the magic happens! Type `@` anywhere in your notes to link entities:

#### Example Notebook Entry:

```
# RNA Extraction Protocol

Date: January 28, 2026
Author: Dr. Smith

## Procedure

1. Retrieved @Sample-P-405 from freezer
   - Cell line: HeLa cells, passage 12
   - Location: Freezer 4, Box B, Slot A1

2. Prepared sample using protocol from @Smith-2024-RNA-Methods
   - Modified concentration to 10mM (higher than standard)
   - Reason: Previous batch showed low yield

3. Loaded into @DNA-Sequencer-A
   - Model: Illumina NovaSeq 6000
   - Serial: NS6000-12345
   - Run settings: Paired-end, 150bp

4. Started sequencing run at 14:30
   - Expected completion: 18 hours
   - Click "Start Import" to auto-link data files
```

### Step 5: Understanding @Mentions

When you type `@`, you'll see a dropdown with three categories:

#### 🔵 Samples (Blue)
- All samples from your freezer inventory
- Shows: Name, Type, Location
- **Snapshot saved:** If you delete the sample later, the notebook keeps all metadata

#### 🟣 Equipment (Purple)
- Laboratory instruments and machines
- Shows: Name, Model, Location
- **Auto-import:** Can automatically pull data files from equipment

#### 🟢 Papers (Green)
- Research papers from your library
- Shows: Title, Authors, Year
- **Citation ready:** Full reference saved in snapshot

### Step 6: Automatic Data Import (Optional)

For equipment with auto-import enabled:

1. Click **"Start Import"** button in notebook
2. Equipment status changes to **LOCKED** (prevents other bookings)
3. When analysis software outputs a data file, `openbio-agent` detects it
4. File uploads automatically to the system
5. Notebook creates a timestamped entry:
   ```
   📁 Data file imported: run_12345.fastq (2.4 GB)
   Equipment: DNA Sequencer A
   Timestamp: January 28, 2026 16:45
   ```

## 🔍 Why Metadata Snapshots Matter

### The Problem:
You mention **@Sample-P-405** in your notebook on January 1st. Six months later, the sample is used up and deleted. Now your notebook has a broken reference!

### The Solution:
When you mention `@Sample-P-405`, OpenBio:
1. Creates a link to the sample (normal reference)
2. **Saves a complete snapshot** of the sample data:
   ```json
   {
     "id": "abc123",
     "name": "Sample P-405",
     "type": "cell_line",
     "metadata": "HeLa cells, passage 12",
     "location": "Freezer 4, Box B, A1",
     "createdAt": "2026-01-01",
     "batch": "2025-12-15"
   }
   ```

Even if the sample is deleted, your notebook entry preserves:
- What it was (HeLa cells)
- Where it came from (Box B, Slot A1)
- When it was created (Dec 15, 2025)
- Which batch it belonged to

### Regulatory Compliance:
This satisfies FDA 21 CFR Part 11 requirements for electronic records:
- ✅ **Audit trail:** Who mentioned what, when
- ✅ **Data integrity:** Snapshots can't be altered
- ✅ **Traceability:** Every mention links to original entity + snapshot
- ✅ **Electronic signatures:** (Coming soon)

## 💾 Saving Your Work

The notebook **auto-saves every 5 seconds** when you make changes. You can also manually save:

1. Click the **"Save"** button (top right)
2. Watch for "Saving..." → "Saved" confirmation

All changes are tracked with timestamps in the database.

## 🔎 Finding Notebooks Later

### By Experiment:
1. Go to **Experiments** tab
2. Click on an experiment
3. See linked notebook

### By Search (Future):
- Full-text search across all notebooks
- Filter by entity mentions
- Date range filtering

## 🎨 Best Practices

### ✅ DO:
- Mention samples/equipment/papers as you use them
- Include deviations from standard protocols
- Note unexpected observations
- Add timestamps for key events
- Attach photos/screenshots (future feature)

### ❌ DON'T:
- Forget to save before closing
- Delete experiments that have notebooks (cascade delete)
- Edit snapshots manually (they're immutable)

## 🔮 Advanced Features (Coming Soon)

- **Templates:** Start with pre-filled protocol templates
- **Collaboration:** Multiple scientists editing same notebook
- **Version Control:** Git integration for full history
- **PDF Export:** Generate reports for regulatory submissions
- **Voice Notes:** Dictate while working at the bench
- **Image Attachments:** Attach microscope images directly

## 🆘 Troubleshooting

### Mention dropdown not appearing:
- Make sure you typed `@` (shift + 2)
- Wait 300ms for debounce
- Check that samples/equipment/papers exist in the system

### Can't save notebook:
- Check network connection (if using Hub/Enterprise mode)
- Verify you have write permissions
- Look for error messages in browser console (F12)

### Data import not working:
- Ensure equipment has `autoImport = true` in settings
- Verify `openbio-agent` is running on equipment PC
- Check watch folder path is correct
- Confirm experiment is scheduled on that equipment

## 📞 Support

For questions or issues:
- Check documentation: `docs/NOTEBOOK_MODULE.md`
- Review implementation: `docs/NOTEBOOK_IMPLEMENTATION_SUMMARY.md`
- File an issue on GitHub

---

**Remember:** The notebook is your experimental memory. Take good notes now, and Future You will thank you! 🧪📝
