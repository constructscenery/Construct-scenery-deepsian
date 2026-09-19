import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Building } from './Building';
import { FreelancerContact } from './FreelancerContact';

abstract class AttachedDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_key', type: 'text' })
  fileKey: string;

  @Column({ name: 'file_name', type: 'text' })
  fileName: string;

  @Column({ name: 'file_size', type: 'bigint' })
  fileSize: string;

  @Column({ name: 'file_mime_type', type: 'text' })
  fileMimeType: string;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;
}

@Entity('building_documents')
export class BuildingDocument extends AttachedDocument {
  @Column({ name: 'building_id', type: 'uuid' })
  buildingId: string;

  @ManyToOne(() => Building, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'building_id' })
  building: Building;
}

@Entity('freelancer_documents')
export class FreelancerDocument extends AttachedDocument {
  @Column({ name: 'freelancer_id', type: 'uuid' })
  freelancerId: string;

  @ManyToOne(() => FreelancerContact, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'freelancer_id' })
  freelancer: FreelancerContact;
}