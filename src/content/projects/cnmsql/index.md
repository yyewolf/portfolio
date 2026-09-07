---
title: "CNMSQL"
description: "Kubernetes operator that brings CloudNativePG's design patterns to MySQL"
date: 2026-06-10
demoURL: "https://cnmsql.co"
repoURL: "https://github.com/cnmsql/cnmsql"
---

CNMSQL is a Kubernetes operator for MySQL, built around the design patterns CloudNativePG established for Postgres. You declare a cluster as a custom resource and the operator handles the rest: provisioning, replication, failover and backups, instead of stitching those together by hand.

## Features

- Declarative clusters: pods, persistent volumes, credentials and TLS provisioned from one resource
- GTID-based replication with automatic failover and planned switchover
- MySQL Group Replication with quorum consensus
- Physical backups with XtraBackup to S3-compatible storage
- Point-in-time recovery via continuous binlog archiving
- Role-aware services routing read-write, read-only and read-any traffic
- Multi-tenancy through cluster-per-tenant or schema-per-tenant
- Rolling upgrades with minimal downtime

## Technologies Used

- Go and the Kubernetes controller-runtime, with CRDs for the API surface
- Percona Server for MySQL (8.0, 8.4, 9.x) and MariaDB (10.11, 11.4, 12.3)
- Percona XtraBackup and S3-compatible object storage
- mTLS between instances, Prometheus metrics for observability

It is an independent project, with no affiliation to Oracle, MySQL, the CNCF or CloudNativePG.
