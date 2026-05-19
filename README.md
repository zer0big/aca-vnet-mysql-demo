# aca-vnet-mysql-demo

Azure Container Apps(ACA) VNet 통합 및 MySQL VM 연결 데모 프로젝트입니다.  
Terraform으로 Azure 인프라(VNet, MySQL VM, Jumpbox VM)를 프로비저닝하고, Node.js 컨테이너 앱을 Azure Container Apps에 배포하여 프라이빗 네트워크를 통해 MySQL DB에 접근하는 아키텍처를 시연합니다.

---

## 목차

- [아키텍처](#아키텍처)
- [프로젝트 구조](#프로젝트-구조)
- [사전 요구사항](#사전-요구사항)
- [배포 방법](#배포-방법)
  - [1. 인프라 프로비저닝 (Terraform)](#1-인프라-프로비저닝-terraform)
  - [2. MySQL 설정](#2-mysql-설정)
  - [3. 컨테이너 이미지 빌드 및 푸시](#3-컨테이너-이미지-빌드-및-푸시)
  - [4. Azure Container Apps 배포](#4-azure-container-apps-배포)
- [환경 변수](#환경-변수)
- [API 엔드포인트](#api-엔드포인트)
- [리소스 정리](#리소스-정리)

---

## 아키텍처

```
인터넷
   │
   │  SSH (포트 22)
   ▼
┌──────────────────────────────────────────────────────┐
│  VNet: vnet-contapp-intg-demo  (10.0.0.0/16)         │
│                                                      │
│  ┌─────────────────────┐  ┌────────────────────────┐ │
│  │  snet-contapp       │  │  snet-jump             │ │
│  │  (10.0.1.0/24)      │  │  (10.0.3.0/24)         │ │
│  │                     │  │                        │ │
│  │  [ACA Environment]  │  │  [Jumpbox VM]          │ │
│  │  [Container App]    │  │  (공인 IP)             │ │
│  └────────┬────────────┘  └────────────────────────┘ │
│           │ MySQL (3306)                              │
│           ▼                                           │
│  ┌─────────────────────┐                             │
│  │  snet-db            │                             │
│  │  (10.0.2.0/24)      │                             │
│  │                     │                             │
│  │  [MySQL VM]         │                             │
│  │  (사설 IP 전용)     │                             │
│  └─────────────────────┘                             │
└──────────────────────────────────────────────────────┘
```

- **Container App**: Node.js 앱을 호스팅하며, VNet을 통해 MySQL VM에 연결합니다.
- **MySQL VM** (`Standard_B2s`, Ubuntu 22.04): 공인 IP 없이 사설 네트워크에만 노출됩니다.
- **Jumpbox VM** (`Standard_B1s`, Ubuntu 22.04): 공인 IP를 가지며 MySQL VM 관리용 SSH 진입점으로 사용됩니다.

---

## 프로젝트 구조

```
aca-vnet-mysql-demo/
├── node-app/
│   ├── Dockerfile          # Node.js 앱 컨테이너 이미지 정의
│   ├── package.json        # 프로젝트 의존성 (express, mysql2)
│   └── server.js           # Express 앱 소스코드
└── terraform/
    ├── main.tf             # 핵심 Azure 리소스 정의
    ├── variables.tf        # 입력 변수 및 기본값
    └── outputs.tf          # 배포 후 출력값 (IP 주소, 서브넷 ID 등)
```

---

## 사전 요구사항

| 도구 | 버전 | 용도 |
|------|------|------|
| [Terraform](https://developer.hashicorp.com/terraform/install) | >= 1.7.0 | 인프라 프로비저닝 |
| [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) | 최신 | Azure 리소스 관리 |
| [Docker](https://docs.docker.com/get-docker/) | 최신 | 컨테이너 이미지 빌드 |
| SSH 키 쌍 | — | VM 접근 (`~/.ssh/id_rsa.pub` 필요) |
| Azure 구독 | — | 리소스 배포 대상 |

---

## 배포 방법

### 1. 인프라 프로비저닝 (Terraform)

```bash
# Azure 로그인
az login

# Terraform 초기화
cd terraform
terraform init

# 배포 미리보기
terraform plan

# 인프라 생성
terraform apply
```

배포 완료 후 출력값을 확인합니다.

```bash
terraform output
# vm_mysql_private_ip = "<MySQL VM 사설 IP>"
# vm_jump_public_ip   = "<Jumpbox 공인 IP>"
# subnet_app_id       = "<ACA 서브넷 ID>"
# subnet_db_id        = "<DB 서브넷 ID>"
```

### 2. MySQL 설정

Jumpbox를 경유하여 MySQL VM에 접속한 뒤 MySQL Server를 설치하고 데이터베이스와 테이블을 구성합니다.

```bash
# Jumpbox 접속
ssh azureuser@<vm_jump_public_ip>

# MySQL VM으로 이동
ssh azureuser@<vm_mysql_private_ip>

# MySQL 설치 (Ubuntu 22.04)
sudo apt-get update
sudo apt-get install -y mysql-server

# MySQL 서비스 시작
sudo systemctl start mysql
sudo systemctl enable mysql

# MySQL 설정 (앱 접속용 사용자 및 DB 생성)
sudo mysql <<'SQL'
CREATE DATABASE appdb;
CREATE USER 'appuser'@'%' IDENTIFIED BY 'YourPassword123!';
GRANT ALL PRIVILEGES ON appdb.* TO 'appuser'@'%';
FLUSH PRIVILEGES;

USE appdb;
CREATE TABLE apache_logs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  access_time      DATETIME,
  client_ip        VARCHAR(45),
  request_url      TEXT,
  http_result_code INT
);
SQL
```

> **참고**: MySQL이 VNet 내부에서 원격 접속을 허용하도록 `/etc/mysql/mysql.conf.d/mysqld.cnf`의 `bind-address`를 `0.0.0.0`으로 변경한 뒤 서비스를 재시작하세요.

### 3. 컨테이너 이미지 빌드 및 푸시

```bash
cd node-app

# 이미지 빌드
docker build -t <your-registry>.azurecr.io/mysql-logs-app:latest .

# Azure Container Registry 로그인
az acr login --name <your-registry>

# 이미지 푸시
docker push <your-registry>.azurecr.io/mysql-logs-app:latest
```

### 4. Azure Container Apps 배포

```bash
# Container Apps 환경 생성 (VNet 통합)
az containerapp env create \
  --name aca-env-demo \
  --resource-group RG-VNet-Integration-Demo \
  --location koreacentral \
  --infrastructure-subnet-resource-id <subnet_app_id>

# Container App 배포
az containerapp create \
  --name mysql-logs-app \
  --resource-group RG-VNet-Integration-Demo \
  --environment aca-env-demo \
  --image <your-registry>.azurecr.io/mysql-logs-app:latest \
  --target-port 80 \
  --ingress external \
  --env-vars \
    DB_HOST=<vm_mysql_private_ip> \
    DB_PORT=3306 \
    DB_NAME=appdb \
    DB_USER=appuser \
    DB_PASS=YourPassword123!
```

---

## 환경 변수

Container App 실행 시 아래 환경 변수를 설정해야 합니다.

| 변수 | 설명 | 예시 |
|------|------|------|
| `DB_HOST` | MySQL VM 사설 IP 주소 | `10.0.2.4` |
| `DB_PORT` | MySQL 포트 (기본값: `3306`) | `3306` |
| `DB_NAME` | 데이터베이스 이름 | `appdb` |
| `DB_USER` | DB 접속 사용자 | `appuser` |
| `DB_PASS` | DB 접속 비밀번호 | `YourPassword123!` |

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/` | 헬스체크. `Hello from Container App` 반환 |
| `GET` | `/logs` | MySQL `apache_logs` 테이블에서 최근 100건 조회 (JSON) |

### 응답 예시 (`GET /logs`)

```json
[
  {
    "access_time": "2024-01-15T10:30:00.000Z",
    "client_ip": "192.168.1.1",
    "request_url": "/index.html",
    "http_result_code": 200
  }
]
```

---

## 리소스 정리

생성된 모든 Azure 리소스를 삭제하려면 아래 명령을 실행합니다.

```bash
cd terraform
terraform destroy
```

> **주의**: `terraform destroy`를 실행하면 리소스 그룹 내 모든 리소스(VM, VNet, 서브넷 등)가 **영구 삭제**됩니다.
