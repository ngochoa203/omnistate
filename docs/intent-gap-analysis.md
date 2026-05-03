# Intent Classification Gap Analysis

## Current Coverage Overview

### Fully Covered (High Confidence)
- ✅ app-launch: Open apps by name
- ✅ media.play/pause: Music control
- ✅ alarm.set: Timer/alarm setting
- ✅ audio-management: Volume control
- ✅ network-control: WiFi toggle
- ✅ power-management: Sleep/shutdown/restart
- ✅ process-management: List/kill processes

### Partially Covered (Medium Confidence)
- ⚠️ app-control: Needs expansion for messaging, form fill
- ⚠️ file-operation: Needs more path patterns
- ⚠️ system-query: Missing some system info queries
- ⚠️ ui-interaction: Missing some UI automation patterns

### Poorly Covered (Low Confidence)
- ❌ voice-control: Only basic support
- ❌ browser-automation: Limited to YouTube
- ❌ multi-step: Needs better decomposition
- ❌ security-management: Camera/mic lock only

## Gaps by Intent Type

### 1. app-control Gaps
**Missing patterns:**
- `gửi email cho X` (send email)
- `tạo event lịch` (create calendar event)  
- `đọc tin nhắn` (read messages)
- `trả lời tin nhắn` (reply to message)
- `forward tin nhắn` (forward message)
- `xoá tin nhắn` (delete message)

**Recommended patterns:**
```typescript
{ pattern: /gửi\s*(?:email|mail)\s*(?:cho|mang|gửi)\s+\w+/i, type: "app-control" }
{ pattern: /tạo\s*(?:event|lịch|cuộc\s*họp)\b/i, type: "app-control" }
{ pattern: /đọc\s*(?:tin\s*nhắn|message|email)\b/i, type: "app-control" }
```

### 2. file-operation Gaps
**Missing patterns:**
- `mở file X bằng app Y` (open file with specific app)
- `rename file X thành Y` (rename file)
- `find . -name "*.log"` type commands
- `so sánh 2 file` (compare files)

### 3. system-query Gaps
**Missing patterns:**
- `whoami` equivalent
- `uname -a` equivalent  
- `which X` equivalent
- Network diagnostics specifics

### 4. ui-interaction Gaps
**Missing patterns:**
- `kéo thả` (drag and drop)
- `nhấn đúp` (double click)
- `chuột phải` (right click)
- `zoom in/out` (pinch/scroll zoom)

### 5. Multi-step Gaps
**Missing patterns:**
- Parallel actions: "mở X và Y cùng lúc"
- Conditional: "nếu X thì làm Y"
- Loop: "lặp lại X 10 lần"

## Recommended Improvements

### 1. Add 50 New Regex Patterns (Priority Order)

**High Priority:**
1. Messaging patterns (Zalo, Telegram, Messages)
2. Calendar/event patterns
3. File comparison patterns
4. Network diagnostics patterns

**Medium Priority:**
5. UI automation patterns (drag, zoom)
6. Email patterns
7. Notification patterns

**Low Priority:**
8. Loop/conditional patterns
9. Parallel execution patterns
10. Complex workflow patterns

### 2. Improve Entity Extraction

**Current issues:**
- App names not always extracted correctly
- Time expressions need normalization
- File paths need better parsing

**Recommended fixes:**
- Add app name normalization map
- Add Vietnamese time parser
- Add path pattern extractor

### 3. Confidence Score Tuning

**Current baseline:** 0.55-0.97

**Recommended adjustments:**
- App launch: 0.95 (high confidence)
- System query: 0.85 (medium-high)
- Multi-step: 0.75 (medium)
- Complex UI: 0.65 (lower)

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
1. Add 20 high-priority patterns
2. Fix entity extraction for app names
3. Tune confidence scores

### Phase 2: Medium Effort (1-2 days)
1. Add 30 medium-priority patterns
2. Improve time/date parsing
3. Add fuzzy app name matching

### Phase 3: Long Term (1-2 weeks)
1. Collect training data
2. Fine-tune classification model
3. Deploy as microservice

## Statistics
- Total current patterns: ~150
- Recommended patterns to add: 50-100
- Target coverage: 95% of common Vietnamese commands
