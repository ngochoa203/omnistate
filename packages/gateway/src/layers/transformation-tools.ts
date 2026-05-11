/**
 * Data Transformation Tools — Advanced Layer (API 82)
 * Implements: Data mapping, aggregation, pivot, reshape operations
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";


export interface TransformConfig {
  input: any[];
  operations: ("map" | "filter" | "reduce" | "groupBy" | "sort" | "pivot")[];
  params: Record<string, any>;
}

export async function mapData<T, R>(
  data: T[],
  mapper: (item: T, index: number) => R
): Promise<R[]> {
  return data.map(mapper);
}

export async function filterData<T>(
  data: T[],
  predicate: (item: T, index: number) => boolean
): Promise<T[]> {
  return data.filter(predicate);
}

export async function aggregateData<T>(
  data: T[],
  groupBy: keyof T,
  aggregator: (items: T[]) => any
): Promise<{ key: any; value: any }[]> {
  const groups = new Map<any, T[]>();
  
  for (const item of data) {
    const key = item[groupBy];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    value: aggregator(items)
  }));
}

export async function pivotData<T>(
  data: T[],
  rows: keyof T,
  cols: keyof T,
  values: keyof T,
  aggregator: "sum" | "count" | "avg" = "sum"
): Promise<any[]> {
  const pivoted: any = {};
  
  for (const item of data) {
    const rowKey = String(item[rows]);
    const colKey = String(item[cols]);
    const value = Number(item[values]);
    
    if (!pivoted[rowKey]) pivoted[rowKey] = {};
    pivoted[rowKey][colKey] = (pivoted[rowKey][colKey] || 0) + value;
  }
  
  return Object.entries(pivoted).map(([row, cols]) => ({ [rows]: row, ...cols as any }));
}

export async function reshapeData<T extends object>(
  data: T[],
  fromShape: Record<string, string>,
  toShape: Record<string, string>
): Promise<Partial<T>[]> {
  return data.map(item => {
    const reshaped: any = {};
    for (const [from, to] of Object.entries(fromShape)) {
      if (from in item) reshaped[to] = item[from as keyof T];
    }
    return reshaped;
  });
}

export class TransformationLayer {
  map = mapData;
  filter = filterData;
  aggregate = aggregateData;
  pivot = pivotData;
  reshape = reshapeData;
}
