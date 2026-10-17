import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ContactsService } from '../../../shared/services/contacts.service';
import { ContactPerson } from '../../../shared/models/contact-person.model';
import { AuthService } from '../../../shared/services/auth.service';

@Component({
    selector: 'app-contacts',
    imports: [
        CommonModule,
        FormsModule,
        ProgressSpinnerModule,
        MessageModule,
        ButtonModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        ConfirmDialogModule,
        ToastModule,
    ],
    providers: [ConfirmationService, MessageService],
    templateUrl: './contacts.html',
    styleUrl: './contacts.css',
})
export class ContactsComponent implements OnInit {
    private contactsService = inject(ContactsService);
    private confirmationService = inject(ConfirmationService);
    private messageService = inject(MessageService);
    public auth = inject(AuthService);

    contacts = this.contactsService.contacts;
    loading = this.contactsService.loading;
    error = this.contactsService.error;

    dialogVisible = signal(false);
    editMode = signal(false);
    saving = signal(false);

    currentContact: Partial<ContactPerson> = this.getEmptyContact();

    ngOnInit(): void {
        this.contactsService.fetchContacts();
    }

    getEmptyContact(): Partial<ContactPerson> {
        return {
            name: '',
            role: '',
            description: '',
            email: '',
            phone: null,
            location: '',
            image_url: null,
        };
    }

    openNew() {
        this.currentContact = this.getEmptyContact();
        this.editMode.set(false);
        this.dialogVisible.set(true);
    }

    editContact(contact: ContactPerson) {
        this.currentContact = { ...contact };
        this.editMode.set(true);
        this.dialogVisible.set(true);
    }

    async saveContact() {
        if (
            !this.currentContact.name ||
            !this.currentContact.email ||
            !this.currentContact.role
        ) {
            return;
        }

        this.saving.set(true);
        try {
            if (this.editMode() && this.currentContact.id) {
                await this.contactsService.updateContact(
                    this.currentContact.id,
                    this.currentContact
                );
                this.messageService.add({
                    severity: 'success',
                    summary: 'Erfolg',
                    detail: 'Ansprechpartner aktualisiert',
                });
            } else {
                await this.contactsService.addContact(
                    this.currentContact as ContactPerson
                );
                this.messageService.add({
                    severity: 'success',
                    summary: 'Erfolg',
                    detail: 'Ansprechpartner erstellt',
                });
            }
            this.dialogVisible.set(false);
        } catch (e) {
            this.messageService.add({
                severity: 'error',
                summary: 'Fehler',
                detail: (e as Error).message,
            });
        }
        this.saving.set(false);
    }

    confirmDelete(contact: ContactPerson) {
        this.confirmationService.confirm({
            message: `Möchtest du "${contact.name}" wirklich löschen?`,
            header: 'Löschen bestätigen',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Ja, löschen',
            rejectLabel: 'Abbrechen',
            accept: async () => {
                try {
                    await this.contactsService.deleteContact(contact.id!);
                    this.messageService.add({
                        severity: 'success',
                        summary: 'Gelöscht',
                        detail: 'Ansprechpartner wurde gelöscht',
                    });
                } catch (e) {
                    this.messageService.add({
                        severity: 'error',
                        summary: 'Fehler',
                        detail: (e as Error).message,
                    });
                }
            },
        });
    }

    trackByContact(_index: number, contact: ContactPerson): string {
        return contact.id ?? contact.name;
    }
}
