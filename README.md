# aca-vnet-mysql-demo

Azure Container Apps와 VNet 통합을 통해 프라이빗 MySQL VM에 안전하게 연결하는 데모 프로젝트입니다.  
Terraform으로 전체 인프라를 프로비저닝하고, Node.js 앱을 컨테이너로 배포합니다.

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [아키텍처](#아키텍처)
- [사전 요구 사항](#사전-요구-사항)
- [리포지터리 구조](#리포지터리-구조)
- [인프라 구성 요소](#인프라-구성-요소)
- [배포 방법](#배포-방법)
  - [1. Terraform으로 인프라 프로비저닝](#1-terraform으로-인프라-프로비저닝)
  - [2. MySQL 설정](#2-mysql-설정)
  - [3. Container App 배포](#3-container-app-배포)
- [Node.js 앱 API](#nodejs-앱-api)
- [환경 변수](#환경-변수)
- [리소스 정리](#리소스-정리)

---

## 프로젝트 개요

이 데모는 다음을 보여줍니다.

- **Azure Container Apps** 환경을 VNet에 통합하여 프라이빗 네트워크 내의 리소스에 접근
- **MySQL**을 공용 IP 없이 프라이빗 서브넷의 Linux VM에서 운영
- **Jumpbox VM**을 통해 프라이빗 DB VM에 SSH 터널로 접근
- **Terraform**을 사용한 IaC(Infrastructure as Code) 방식의 전체 인프라 관리

---

## 아키텍처

```
Internet
   │
   ▼
┌─────────────────────────────────────────────────────┐
│  VNet: 10.0.0.0/16                                  │
│                                                     │
│  ┌─────────────────────┐   ┌─────────────────────┐  │
│  │ snet-contapp        │   │ snet-db             │  │
│  │ 10.0.1.0/24         │   │ 10.0.2.0/24         │  │
│  │  (ACA delegated)    │   │  NSG: allow 3306    │  │
│  │                     │   │                     │  │
│  │  ┌───────────────┐  │   │  ┌───────────────┐  │  │
│  │  │ Container App │──┼───┼─▶│ vm-mysql      │  │  │
│  │  │ (Node.js)     │  │   │  │ (MySQL, no    │  │  │
│  │  └───────────────┘  │   │  │  public IP)   │  │  │
│  └─────────────────────┘   │  └───────────────┘  │  │
│                             └─────────────────────┘  │
│  ┌─────────────────────┐                             │
│  │ snet-jump           │                             │
│  │ 10.0.3.0/24         │                             │
│  │  NSG: allow SSH     │                             │
│  │  ┌───────────────┐  │                             │
│  │  │ vm-jump       │◀─┼──── SSH (port 22)           │
│  │  │ (Public IP)   │  │                             │
│  │  └───────────────┘  │                             │
│  └─────────────────────┘                             │
└─────────────────────────────────────────────────────┘
```

---

## 사전 요구 사항

| 도구 | 버전 |
|------|------|
| [Terraform](https://developer.hashicorp.com/terraform/install) | >= 1.7.0 |
| [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) | 최신 버전 |
| [Docker](https://docs.docker.com/get-docker/) | 최신 버전 |
| SSH 키 쌍 | `~/.ssh/id_rsa.pub` 필요 |

Azure 구독에 로그인한 상태여야 합니다.

```bash
az login
az account set --subscription "<구독 ID>"
```

---

## 리포지터리 구조

```
aca-vnet-mysql-demo/
├── node-app/               # Node.js 애플리케이션
│   ├── server.js           # Express 서버 (/ 및 /logs 엔드포인트)
│   ├── package.json        # 의존성 (express, mysql2)
│   ├── Dockerfile          # 컨테이너 이미지 빌드 설정
│   └── .dockerignore
└── terraform/              # 인프라 코드 (IaC)
    ├── main.tf             # 주요 리소스 정의
    ├── variables.tf        # 입력 변수 및 기본값
    └── outputs.tf          # 출력값 (VM IP, 서브넷 ID 등)
```

---

## 인프라 구성 요소

| 리소스 | 이름 (기본값) | 설명 |
|--------|--------------|------|
| Resource Group | `RG-VNet-Integration-Demo` | 모든 리소스를 담는 그룹 |
| Virtual Network | `vnet-contapp-intg-demo` | 주소 공간 `10.0.0.0/16` |
| Subnet (ACA) | `snet-contapp` (`10.0.1.0/24`) | Container App 환경 전용 (위임 서브넷) |
| Subnet (DB) | `snet-db` (`10.0.2.0/24`) | MySQL VM 서브넷, NSG로 3306 포트 허용 |
| Subnet (Jump) | `snet-jump` (`10.0.3.0/24`) | Jumpbox VM 서브넷, NSG로 SSH 허용 |
| VM (MySQL) | `vm-mysql` | Ubuntu 22.04, Standard_B2s, 공용 IP 없음 |
| VM (Jumpbox) | `vm-jump` | Ubuntu 22.04, Standard_B1s, 공용 Static IP |

기본 위치(region)는 `koreacentral`이며, `variables.tf`에서 변경할 수 있습니다.

---

## 배포 방법

### 1. Terraform으로 인프라 프로비저닝

```bash
cd terraform

# 초기화
terraform init

# 변경 사항 미리 보기
terraform plan

# 인프라 배포
terraform apply
```

배포 완료 후 출력값을 확인합니다.

```bash
terraform output
# vm_mysql_private_ip = "10.0.2.x"
# vm_jump_public_ip   = "x.x.x.x"
# subnet_app_id       = "/subscriptions/.../snet-contapp"
# subnet_db_id        = "/subscriptions/.../snet-db"
```

### 2. MySQL 설정

Jumpbox를 통해 MySQL VM에 접속하여 MySQL을 설치하고 DB와 테이블을 생성합니다.

```bash
# Jumpbox에 SSH 접속
ssh azureuser@<vm_jump_public_ip>

# Jumpbox에서 MySQL VM으로 SSH 터널
ssh azureuser@<vm_mysql_private_ip>

# MySQL 설치 (Ubuntu 22.04)
sudo apt update && sudo apt install -y mysql-server
sudo mysql_secure_installation

# DB 및 테이블 생성
sudo mysql -u root -p <<'EOF'
CREATE DATABASE appdb;
USE appdb;
CREATE TABLE apache_logs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  access_time      DATETIME,
  client_ip        VARCHAR(45),
  request_url      VARCHAR(255),
  http_result_code INT
);
CREATE USER 'appuser'@'%' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON appdb.* TO 'appuser'@'%';
FLUSH PRIVILEGES;
EOF
```

### 3. Container App 배포

#### 컨테이너 이미지 빌드 및 푸시

```bash
cd node-app

# Azure Container Registry(ACR) 또는 Docker Hub에 이미지 푸시
docker build -t <registry>/mysql-logs-app:latest .
docker push <registry>/mysql-logs-app:latest
```

#### Azure Container App 생성

```bash
# Container Apps 확장 설치
az extension add --name containerapp --upgrade

# Container Apps 환경 생성 (VNet 통합)
az containerapp env create \
  --name cae-demo \
  --resource-group RG-VNet-Integration-Demo \
  --location koreacentral \
  --infrastructure-subnet-resource-id <subnet_app_id>

# Container App 배포
az containerapp create \
  --name ca-mysql-logs \
  --resource-group RG-VNet-Integration-Demo \
  --environment cae-demo \
  --image <registry>/mysql-logs-app:latest \
  --target-port 80 \
  --ingress external \
  --env-vars \
      DB_HOST=<vm_mysql_private_ip> \
      DB_PORT=3306 \
      DB_NAME=appdb \
      DB_USER=appuser \
      DB_PASS=yourpassword
```

---

## Node.js 앱 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/` | 헬스 체크 — `Hello from Container App` 반환 |
| `GET` | `/logs` | MySQL의 `apache_logs` 테이블에서 최신 100건 조회 |

`/logs` 응답 예시:

```json
[
  {
    "access_time": "2024-01-01T00:00:00.000Z",
    "client_ip": "192.168.0.1",
    "request_url": "/index.html",
    "http_result_code": 200
  }
]
```

---

## 환경 변수

Node.js 앱은 다음 환경 변수를 사용합니다.

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `DB_HOST` | ✅ | — | MySQL VM의 프라이빗 IP 주소 |
| `DB_PORT` | ❌ | `3306` | MySQL 포트 |
| `DB_NAME` | ✅ | — | 데이터베이스 이름 |
| `DB_USER` | ✅ | — | MySQL 사용자 이름 |
| `DB_PASS` | ✅ | — | MySQL 사용자 비밀번호 |

---

## 리소스 정리

데모 완료 후 Azure 과금을 방지하려면 모든 리소스를 삭제합니다.

```bash
cd terraform
terraform destroy
```
