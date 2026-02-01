/**
 * Simple file-based storage for Geeksy
 * Uses JSON files for persistence, Map for in-memory operations
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export class SimpleStore<T extends { id: string }> {
    private items: Map<string, T> = new Map();
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // Load existing data
        this.load();
    }

    private load(): void {
        try {
            if (existsSync(this.filePath)) {
                const data = readFileSync(this.filePath, 'utf-8');
                const items = JSON.parse(data) as T[];
                for (const item of items) {
                    this.items.set(item.id, item);
                }
            }
        } catch {
            // File doesn't exist or is invalid, start fresh
        }
    }

    private save(): void {
        try {
            const items = Array.from(this.items.values());
            writeFileSync(this.filePath, JSON.stringify(items, null, 2));
        } catch (e) {
            console.error('Failed to save:', e);
        }
    }

    async insert(item: T): Promise<T> {
        this.items.set(item.id, item);
        this.save();
        return item;
    }

    async findOne(filter: Partial<T>): Promise<T | undefined> {
        for (const item of this.items.values()) {
            if (this.matches(item, filter)) {
                return item;
            }
        }
        return undefined;
    }

    async findMany(filter: Partial<T>, limit?: number): Promise<T[]> {
        const results: T[] = [];
        for (const item of this.items.values()) {
            if (this.matches(item, filter)) {
                results.push(item);
                if (limit && results.length >= limit) break;
            }
        }
        return results;
    }

    async all(): Promise<T[]> {
        return Array.from(this.items.values());
    }

    // Synchronous methods for SSR
    allSync(): T[] {
        return Array.from(this.items.values());
    }

    findManySync(filter: Partial<T>, limit?: number): T[] {
        const results: T[] = [];
        for (const item of this.items.values()) {
            if (this.matches(item, filter)) {
                results.push(item);
                if (limit && results.length >= limit) break;
            }
        }
        return results;
    }

    async update(filter: Partial<T>, updates: Partial<T>): Promise<void> {
        for (const [id, item] of this.items.entries()) {
            if (this.matches(item, filter)) {
                this.items.set(id, { ...item, ...updates });
            }
        }
        this.save();
    }

    async delete(filter: Partial<T>): Promise<void> {
        for (const [id, item] of this.items.entries()) {
            if (this.matches(item, filter)) {
                this.items.delete(id);
            }
        }
        this.save();
    }

    private matches(item: T, filter: Partial<T>): boolean {
        for (const [key, value] of Object.entries(filter)) {
            if ((item as any)[key] !== value) return false;
        }
        return true;
    }
}
