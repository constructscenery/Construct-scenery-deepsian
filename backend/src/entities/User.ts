import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserRole } from '../enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text', name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'text', name: 'full_name' })
  fullName: string;

  @Column({ type: 'text' })
  role: UserRole;

  @Column({ type: 'text', name: 'display_password', nullable: true })
  displayPassword: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
