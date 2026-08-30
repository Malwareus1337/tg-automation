import os
import asyncio
import datetime
import shutil
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional, Dict

from backend.database import Database
from backend.telegram_client import TelegramManager

app = FastAPI(title="Telegram Automation API")

# Enable CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = Database()
active_tasks: Dict[str, asyncio.Task] = {}

# WebSocket Log Broadcaster
class LogBroadcaster:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        
    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        
    async def send_log(self, message: str):
        formatted_message = f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {message}"
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(formatted_message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

log_broadcaster = LogBroadcaster()

# Request Models
class LoginStartRequest(BaseModel):
    phone: str
    api_id: int
    api_hash: str

class LoginCompleteRequest(BaseModel):
    phone: str
    code: str
    password: Optional[str] = None

class SettingUpdateRequest(BaseModel):
    key: str
    value: str

class ScrapeTaskRequest(BaseModel):
    account_phone: str
    group_link: str
    filter_days: Optional[int] = None
    hidden_member_fallback: bool = True

class AddTaskRequest(BaseModel):
    target_group_link: str
    phones_to_use: List[str]
    min_delay: int
    max_delay: int
    daily_limit_per_acc: int

class SendTaskRequest(BaseModel):
    targets: List[str]
    message_text: str
    phones_to_use: List[str]
    min_delay: int
    max_delay: int
    daily_limit_per_acc: int

class IntervalPostRequest(BaseModel):
    phones_to_use: List[str]
    targets: List[str]
    message_text: Optional[str] = ""
    interval_minutes: int
    send_to_all_joined: bool = False
    image_path: Optional[str] = None
    account_messages: Optional[Dict[str, str]] = None
    account_images: Optional[Dict[str, str]] = None


# REST Endpoints
@app.get("/api/accounts")
def get_accounts():
    return db.get_accounts()

@app.post("/api/accounts/login/start")
async def login_start(req: LoginStartRequest):
    try:
        res = await TelegramManager.start_login(req.phone, req.api_id, req.api_hash)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/accounts/login/complete")
async def login_complete(req: LoginCompleteRequest):
    try:
        res = await TelegramManager.complete_login(req.phone, req.code, req.password)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/accounts/{phone}")
async def delete_account(phone: str):
    try:
        await TelegramManager.close_client(phone)
        db.delete_account(phone)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/accounts/{phone}/check")
async def check_account(phone: str):
    try:
        res = await TelegramManager.check_account_status(phone)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/accounts/check-all")
async def check_all_accounts():
    accounts = db.get_accounts()
    results = []
    for acc in accounts:
        try:
            res = await TelegramManager.check_account_status(acc["phone"])
            results.append(res)
        except Exception as e:
            results.append({"phone": acc["phone"], "status": "error", "message": str(e)})
    return results

@app.get("/api/settings")
def get_settings():
    return db.get_settings()

@app.post("/api/settings")
def update_setting(req: SettingUpdateRequest):
    try:
        db.update_setting(req.key, req.value)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/scraped-members")
def get_scraped_members(status: Optional[str] = None):
    return db.get_scraped_members(status=status)

@app.post("/api/scraped-members/clear")
def clear_scraped_members():
    db.clear_scraped_members()
    return {"status": "success"}

@app.get("/api/tasks/status")
def get_task_status():
    status_dict = {}
    any_running = False
    for t_name, t_task in active_tasks.items():
        is_running = (t_task is not None and not t_task.done())
        status_dict[t_name] = is_running
        if is_running:
            any_running = True
    return {
        "running": any_running,
        "tasks": {
            "scrape": status_dict.get("scrape", False),
            "add": status_dict.get("add", False),
            "send": status_dict.get("send", False),
            "autopost": status_dict.get("autopost", False),
        }
    }

@app.post("/api/tasks/stop")
def stop_task(task_type: Optional[str] = None):
    if task_type and task_type in active_tasks:
        t = active_tasks[task_type]
        if t and not t.done():
            t.cancel()
            return {"status": "cancelled", "task_type": task_type}
        return {"status": "not_running", "task_type": task_type}
    else:
        # Cancel all running tasks
        cancelled = []
        for t_name, t in active_tasks.items():
            if t and not t.done():
                t.cancel()
                cancelled.append(t_name)
        return {"status": "cancelled_all", "cancelled": cancelled}

# Task Execution Wrappers
async def run_scrape_task(req: ScrapeTaskRequest):
    async def log_cb(msg):
        await log_broadcaster.send_log(msg)
        
    try:
        await log_cb(f"Üye çekme işlemi başladı: {req.group_link}")
        count = await TelegramManager.scrape_group(
            account_phone=req.account_phone,
            group_link=req.group_link,
            filter_days=req.filter_days,
            hidden_member_fallback=req.hidden_member_fallback,
            log_callback=log_cb
        )
        await log_cb(f"İşlem başarıyla tamamlandı. Çekilen üye sayısı: {count}")
    except asyncio.CancelledError:
        await log_cb("İşlem kullanıcı tarafından iptal edildi.")
    except Exception as e:
        await log_cb(f"İşlem sırasında hata oluştu: {str(e)}")

async def run_add_task(req: AddTaskRequest):
    async def log_cb(msg):
        await log_broadcaster.send_log(msg)
        
    try:
        await log_cb(f"Üye ekleme işlemi başladı. Hedef: {req.target_group_link}")
        await TelegramManager.add_members_to_group(
            target_group_link=req.target_group_link,
            phones_to_use=req.phones_to_use,
            min_delay=req.min_delay,
            max_delay=req.max_delay,
            daily_limit_per_acc=req.daily_limit_per_acc,
            log_callback=log_cb
        )
    except asyncio.CancelledError:
        await log_cb("Ekleme işlemi iptal edildi.")
    except Exception as e:
        await log_cb(f"Ekleme işleminde genel hata: {str(e)}")

async def run_send_task(req: SendTaskRequest):
    async def log_cb(msg):
        await log_broadcaster.send_log(msg)
        
    try:
        await log_cb(f"Toplu mesaj gönderme işlemi başladı.")
        await TelegramManager.send_bulk_messages(
            targets=req.targets,
            message_text=req.message_text,
            phones_to_use=req.phones_to_use,
            min_delay=req.min_delay,
            max_delay=req.max_delay,
            daily_limit_per_acc=req.daily_limit_per_acc,
            log_callback=log_cb
        )
    except asyncio.CancelledError:
        await log_cb("Mesaj gönderimi iptal edildi.")
    except Exception as e:
        await log_cb(f"Mesaj gönderiminde genel hata: {str(e)}")

async def run_interval_post_task(req: IntervalPostRequest):
    async def log_cb(msg):
        await log_broadcaster.send_log(msg)
        
    try:
        import random
        await log_cb(f"Otomatik paylaşım görevi başlatıldı. Aralık: {req.interval_minutes} dakika.")
        
        while True:
            for phone in req.phones_to_use:
                acc = next((a for a in db.get_accounts() if a["phone"] == phone), None)
                if not acc or acc["status"] != "active":
                    await log_cb(f"[{phone}] Aktif hesap bulunamadı, atlanıyor.")
                    continue
                
                try:
                    client = await TelegramManager.ensure_connected(acc)
                    if not await client.is_user_authorized():
                        await log_cb(f"[{phone}] Yetkilendirme hatası, atlanıyor.")
                        continue
                    
                    # Resolve phone specific message and image, fallback to general
                    phone_msg = (req.account_messages.get(phone) if req.account_messages and req.account_messages.get(phone) else req.message_text) or ""
                    phone_img = req.account_images.get(phone) if req.account_images and req.account_images.get(phone) else req.image_path
                    
                    if not phone_msg and not phone_img:
                        await log_cb(f"[{phone}] Gönderilecek mesaj veya görsel tanımlanmamış, atlanıyor.")
                        continue
                    
                    actual_targets = []
                    if req.send_to_all_joined:
                        try:
                            dialogs = []
                            async for dialog in client.iter_dialogs():
                                if dialog.is_group or dialog.is_channel:
                                    dialogs.append(dialog.entity)
                            actual_targets = dialogs
                            await log_cb(f"[{phone}] Katılınan {len(actual_targets)} grup/kanal tespit edildi.")
                        except Exception as e:
                            await log_cb(f"[{phone}] Katılınan grupları çekme hatası: {str(e)}")
                    else:
                        for t in req.targets:
                            t = t.strip()
                            if t:
                                try:
                                    entity = await client.get_entity(t)
                                    actual_targets.append(entity)
                                except Exception as e:
                                    await log_cb(f"[{phone}] Hedef çözülemedi ({t}): {str(e)}")
                    
                    for target in actual_targets:
                        try:
                            t_name = getattr(target, 'title', getattr(target, 'username', str(target.id)))
                            if phone_img and os.path.exists(phone_img):
                                if len(phone_msg) > 1024:
                                    # Telegram caption limit is 1024 characters for free accounts.
                                    # Send image first, then send message text as a separate message.
                                    await client.send_file(target, phone_img)
                                    if phone_msg:
                                        await client.send_message(target, phone_msg)
                                else:
                                    await client.send_file(target, phone_img, caption=phone_msg)
                            else:
                                if phone_msg:
                                    await client.send_message(target, phone_msg)
                            await log_cb(f"[{phone}] -> '{t_name}' grubuna mesaj başarıyla gönderildi. ✅")
                            await asyncio.sleep(random.randint(2, 5))
                        except Exception as e:
                            err_msg = str(e).lower()
                            err_name = type(e).__name__.lower()
                            if "cannot send" in err_msg or "restricted" in err_msg or "media" in err_msg or "photo" in err_name or "media" in err_name:
                                try:
                                    await log_cb(f"[{phone}] -> '{t_name}' grubunda fotoğraf/medya izni yok. Sadece metin gönderiliyor...")
                                    if phone_msg:
                                        await client.send_message(target, phone_msg)
                                        await log_cb(f"[{phone}] -> '{t_name}' grubuna sadece metin başarıyla gönderildi. ✅")
                                        await asyncio.sleep(random.randint(2, 5))
                                except Exception as text_e:
                                    await log_cb(f"[{phone}] Hata (metin de gönderilemedi): {str(text_e)}")
                            else:
                                await log_cb(f"[{phone}] Hata (mesaj gönderilemedi): {str(e)}")
                except Exception as phone_e:
                    await log_cb(f"[{phone}] İşlem sırasında hata: {str(phone_e)}")
                finally:
                    pass
            
            await log_cb(f"Otomatik paylaşım döngüsü tamamlandı. {req.interval_minutes} dakika bekleniyor...")
            await asyncio.sleep(req.interval_minutes * 60)
            
    except asyncio.CancelledError:
        await log_cb("Otomatik paylaşım görevi durduruldu.")
    except Exception as e:
        await log_cb(f"Otomatik paylaşım görevinde genel hata: {str(e)}")

@app.post("/api/tasks/scrape")
async def start_scrape(req: ScrapeTaskRequest):
    if "scrape" in active_tasks and not active_tasks["scrape"].done():
        raise HTTPException(status_code=400, detail="Üye çekme işlemi zaten çalışıyor.")
    active_tasks["scrape"] = asyncio.create_task(run_scrape_task(req))
    return {"status": "started"}

@app.post("/api/tasks/add")
async def start_add(req: AddTaskRequest):
    if "add" in active_tasks and not active_tasks["add"].done():
        raise HTTPException(status_code=400, detail="Üye ekleme işlemi zaten çalışıyor.")
    active_tasks["add"] = asyncio.create_task(run_add_task(req))
    return {"status": "started"}

@app.post("/api/tasks/send")
async def start_send(req: SendTaskRequest):
    if "send" in active_tasks and not active_tasks["send"].done():
        raise HTTPException(status_code=400, detail="Toplu mesaj gönderme işlemi zaten çalışıyor.")
    active_tasks["send"] = asyncio.create_task(run_send_task(req))
    return {"status": "started"}

@app.post("/api/tasks/autopost")
async def start_autopost(req: IntervalPostRequest):
    if "autopost" in active_tasks and not active_tasks["autopost"].done():
        raise HTTPException(status_code=400, detail="Otomatik paylaşım işlemi zaten çalışıyor.")
    active_tasks["autopost"] = asyncio.create_task(run_interval_post_task(req))
    return {"status": "started"}

@app.get("/api/accounts/{phone}/chats")
async def get_account_chats(phone: str):
    try:
        chats = await TelegramManager.get_joined_chats_for_phone(phone)
        return chats
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    try:
        upload_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"file_path": file_path}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# WebSockets Endpoint
@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await log_broadcaster.connect(websocket)
    try:
        while True:
            # Keep connection alive, listen for client messages (if any)
            await websocket.receive_text()
    except WebSocketDisconnect:
        log_broadcaster.disconnect(websocket)
    except Exception:
        log_broadcaster.disconnect(websocket)

# Serve Frontend static assets
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:
    @app.get("/")
    async def root_fallback():
        return {"message": "Frontend files not found. Place index.html inside frontend/ directory."}
