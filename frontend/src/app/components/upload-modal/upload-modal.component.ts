import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentItem } from '../../models/document.model';

@Component({
  selector: 'app-upload-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="close()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Upload Document</h3>
            <p class="modal-sub">{{ document.name }}</p>
          </div>
          <button class="btn btn-ghost btn-icon" (click)="close()">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Drag and Drop Area -->
          <div 
            class="dropzone" 
            [class.drag-over]="isDragOver()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
            (click)="fileInput.click()"
          >
            <input 
              #fileInput 
              type="file" 
              style="display: none" 
              (change)="onFileSelected($event)" 
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
            >
            <div class="dropzone-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </div>
            @if (selectedFile()) {
              <div class="selected-file-card">
                <span class="file-name">{{ selectedFile()?.name }}</span>
                <span class="file-size font-mono">({{ formatBytes(selectedFile()?.size || 0) }})</span>
                <button type="button" class="btn btn-ghost btn-sm" (click)="clearFile($event)">Remove</button>
              </div>
            } @else {
              <div class="dropzone-text">
                <strong>Click to browse</strong> or drag & drop document file here
              </div>
              <div class="dropzone-hint">
                Supports PDF, DOCX, PNG, JPG, WEBP (Max 25 MB)
              </div>
            }
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" (click)="close()" [disabled]="uploading()">Cancel</button>
          <button 
            type="button" 
            class="btn btn-primary" 
            [disabled]="!selectedFile() || uploading()"
            (click)="submitUpload()"
          >
            @if (uploading()) {
              <span class="spinner"></span> Uploading...
            } @else {
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload
            }
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-badge { margin-bottom: 6px; }
    .modal-title { font-size: 1.35rem; font-weight: 700; color: #1C1917; margin-bottom: 2px; }
    .modal-sub { font-size: 0.85rem; color: #78716C; }



    .dropzone {
      border: 2px dashed rgba(241, 90, 36, 0.35);
      background: #FAF7F2;
      border-radius: var(--radius-lg);
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s;
      &:hover, &.drag-over {
        border-color: #F15A24;
        background: #FFF7ED;
      }
    }

    .dropzone-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #FFF1EE;
      color: #F15A24;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }

    .dropzone-text {
      font-size: 0.92rem;
      color: #1C1917;
      margin-bottom: 4px;
      strong { color: #E64323; }
    }

    .dropzone-hint {
      font-size: 0.78rem;
      color: #78716C;
    }

    .selected-file-card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 16px;
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      border-radius: var(--radius-md);
      .file-name { font-size: 0.88rem; font-weight: 600; color: #C2410C; }
      .file-size { font-size: 0.78rem; color: #78716C; }
    }


    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class UploadModalComponent {
  @Input({ required: true }) document!: DocumentItem;
  @Input() uploading = signal<boolean>(false);
  @Output() onUpload = new EventEmitter<{ file: File; notes: string }>();
  @Output() onCancel = new EventEmitter<void>();

  selectedFile = signal<File | null>(null);
  isDragOver = signal<boolean>(false);
  notes = '';

  get isReupload(): boolean {
    return this.document.uploadStatus === 'Uploaded';
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
    }
  }

  clearFile(event: Event) {
    event.stopPropagation();
    this.selectedFile.set(null);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragOver.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.selectedFile.set(event.dataTransfer.files[0]);
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  submitUpload() {
    const file = this.selectedFile();
    if (file) {
      this.onUpload.emit({ file, notes: this.notes });
    }
  }

  close() {
    this.onCancel.emit();
  }
}
