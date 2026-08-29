import os
import asyncio
import time
import datetime
import random
from telethon import TelegramClient
from telethon.tl.types import UserStatusOnline, UserStatusOffline, UserStatusRecently, UserStatusLastWeek, UserStatusLastMonth
from telethon.tl.functions.channels import InviteToChannelRequest, JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest
from telethon.errors import PeerFloodError, UserPrivacyRestrictedError, FloodWaitError, SessionPasswordNeededError
from backend.database import Database

SESSIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sessions")
os.makedirs(SESSIONS_DIR, exist_ok=True)

db = Database()

# Global dictionary to hold temporary login clients
# phone -> {"client": TelegramClient, "phone_code_hash": str}
login_sessions = {}

# Global client pool for persistent shared connections
_client_pool = {}

def get_user_activity(user):
    if not user.status:
        return "Unknown"
    if isinstance(user.status, UserStatusOnline):
        return "Online"
    if isinstance(user.status, UserStatusOffline):
        return user.status.was_online.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(user.status, UserStatusRecently):
        return "Recently (Last 3 days)"
    if isinstance(user.status, UserStatusLastWeek):
        return "Last Week"
    if isinstance(user.status, UserStatusLastMonth):
        return "Last Month"
    return "Unknown"

def check_activity_limit(user, max_days):
    if not user.status:
        return False
    if isinstance(user.status, UserStatusOnline):
        return True
    if isinstance(user.status, UserStatusRecently):
        return max_days >= 3
    if isinstance(user.status, UserStatusLastWeek):
        return max_days >= 7
    if isinstance(user.status, UserStatusLastMonth):
        return max_days >= 30
    if isinstance(user.status, UserStatusOffline):
        try:
            was_online = user.status.was_online
            # make timezone naive or aware to compare
            now = datetime.datetime.now(datetime.timezone.utc)
            delta = now - was_online
            return delta.days <= max_days
        except Exception:
            return False
    return False

class TelegramManager:
    @staticmethod
    async def start_login(phone, api_id, api_hash):
        session_path = os.path.join(SESSIONS_DIR, f"sess_{phone}")
        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()
        
        try:
            send_code_result = await client.send_code_request(phone)
            login_sessions[phone] = {
                "client": client,
                "phone_code_hash": send_code_result.phone_code_hash,
                "api_id": int(api_id),
                "api_hash": api_hash
            }
            return {"status": "code_sent", "phone": phone}
        except Exception as e:
            await client.disconnect()
            raise e

    @staticmethod
    async def complete_login(phone, code, password=None):
        if phone not in login_sessions:
            raise ValueError("Oturum başlatılmadı veya süresi doldu.")
            
        session_data = login_sessions[phone]
        client = session_data["client"]
        phone_code_hash = session_data["phone_code_hash"]
        api_id = session_data["api_id"]
        api_hash = session_data["api_hash"]
        
        try:
            if password:
                await client.sign_in(password=password)
            else:
                try:
                    await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                except SessionPasswordNeededError:
                    return {"status": "2fa_required", "phone": phone}
            
            # Check authorization
            me = await client.get_me()
            if me:
                db.add_or_update_account(
                    phone=phone,
                    api_id=api_id,
                    api_hash=api_hash,
                    session_name=f"sess_{phone}",
                    status="active"
                )
                # Cleanup login cache, keep connection open or let it close
                await client.disconnect()
                login_sessions.pop(phone, None)
                return {"status": "success", "username": me.username or me.first_name}
            else:
                raise ValueError("Giriş başarısız.")
        except Exception as e:
            await client.disconnect()
            login_sessions.pop(phone, None)
            raise e

    @staticmethod
    def get_client(account_dict):
        phone = account_dict["phone"]
        if phone in _client_pool:
            return _client_pool[phone]
        session_name = account_dict.get("session_name", f"sess_{phone}")
        session_path = os.path.join(SESSIONS_DIR, session_name)
        client = TelegramClient(session_path, int(account_dict["api_id"]), account_dict["api_hash"])
        _client_pool[phone] = client
        return client

    @staticmethod
    async def ensure_connected(account_dict):
        client = TelegramManager.get_client(account_dict)
        if not client.is_connected():
            await client.connect()
        return client

    @staticmethod
    async def close_client(phone):
        if phone in _client_pool:
            client = _client_pool.pop(phone)
            try:
                await client.disconnect()
            except Exception:
                pass

    @staticmethod
    async def scrape_group(account_phone, group_link, filter_days=None, hidden_member_fallback=False, log_callback=None):
        accounts = db.get_accounts()
        acc = next((a for a in accounts if a["phone"] == account_phone), None)
        if not acc:
            raise ValueError("Hesap bulunamadı.")
            
        client = await TelegramManager.ensure_connected(acc)
        
        if not await client.is_user_authorized():
            db.update_account_status(account_phone, "need_login")
            raise ValueError("Hesap yetkilendirmesi başarısız, tekrar giriş yapın.")
            
        try:
            if log_callback:
                await log_callback(f"Grup çözümleniyor: {group_link}")
                
            # Handle invite link vs username
            if "t.me/+" in group_link or "t.me/joinchat/" in group_link:
                # Private group invite link
                invite_hash = group_link.split("+")[-1].split("joinchat/")[-1]
                try:
                    entity = await client(ImportChatInviteRequest(invite_hash))
                    entity = entity.chats[0]
                except Exception as e:
                    # might already be joined
                    if log_callback:
                        await log_callback(f"Davet linki içe aktarılamadı (zaten katılmış olabilirsiniz): {str(e)}")
                    entity = await client.get_entity(group_link)
            else:
                entity = await client.get_entity(group_link)
                
            scraped = []
            
            if log_callback:
                await log_callback("Üye listesi çekiliyor...")
                
            # Try normal participant fetching
            normal_scrape_success = False
            try:
                async for user in client.iter_participants(entity):
                    if user.bot:
                        continue
                    
                    last_active = get_user_activity(user)
                    if filter_days is not None:
                        if not check_activity_limit(user, filter_days):
                            continue
                            
                    scraped.append({
                        'user_id': user.id,
                        'username': user.username,
                        'first_name': user.first_name,
                        'last_name': user.last_name,
                        'source_group': group_link,
                        'last_active': last_active,
                        'scraped_at': int(time.time())
                    })
                normal_scrape_success = True
            except Exception as e:
                if log_callback:
                    await log_callback(f"Standart üye çekme başarısız oldu (Grup gizli olabilir): {str(e)}")
            
            # Fallback to scraping message history
            if not normal_scrape_success and hidden_member_fallback:
                if log_callback:
                    await log_callback("Sohbet geçmişinden aktif üyeleri çekme fallback modu başlatılıyor...")
                seen_users = set()
                # Scrape from the last 1500 messages
                message_count = 0
                async for message in client.iter_messages(entity, limit=1500):
                    message_count += 1
                    if message.sender_id and message.sender_id not in seen_users:
                        seen_users.add(message.sender_id)
                        try:
                            user = await client.get_entity(message.sender_id)
                            if user.bot:
                                continue
                            last_active = get_user_activity(user)
                            if filter_days is not None:
                                if not check_activity_limit(user, filter_days):
                                    continue
                            scraped.append({
                                'user_id': user.id,
                                'username': user.username,
                                'first_name': user.first_name,
                                'last_name': user.last_name,
                                'source_group': group_link,
                                'last_active': last_active,
                                'scraped_at': int(time.time())
                            })
                        except Exception:
                            pass
                if log_callback:
                    await log_callback(f"{message_count} mesaj tarandı, {len(scraped)} aktif kullanıcı tespit edildi.")
                    
            if len(scraped) > 0:
                db.save_scraped_members(scraped)
                if log_callback:
                    await log_callback(f"Toplam {len(scraped)} üye başarıyla veritabanına kaydedildi.")
            else:
                if log_callback:
                    await log_callback("Hiç üye çekilemedi.")
                    
            return len(scraped)
            
        finally:
            pass

    @staticmethod
    async def add_members_to_group(target_group_link, phones_to_use, min_delay, max_delay, daily_limit_per_acc, log_callback=None):
        if not phones_to_use:
            raise ValueError("Kullanılacak hesap seçilmedi.")
            
        all_members = db.get_scraped_members(status="pending")
        if not all_members:
            if log_callback:
                await log_callback("Eklenecek 'pending' durumunda üye bulunamadı.")
            return
            
        if log_callback:
            await log_callback(f"Toplam {len(all_members)} aday üye üzerinde ekleme işlemi başlıyor...")
            
        # Connect all selected accounts
        clients = {}
        account_status = {} # phone -> daily_count
        
        for phone in phones_to_use:
            acc = next((a for a in db.get_accounts() if a["phone"] == phone), None)
            if acc and acc["status"] == "active":
                client = await TelegramManager.ensure_connected(acc)
                if await client.is_user_authorized():
                    clients[phone] = client
                    account_status[phone] = 0
                    if log_callback:
                        await log_callback(f"Hesap bağlandı: {phone}")
                else:
                    db.update_account_status(phone, "need_login")
                    if log_callback:
                        await log_callback(f"Hesap yetkilendirmesi geçersiz: {phone}")
                        
        if not clients:
            raise ValueError("Kullanılabilir aktif hesap kalmadı.")
            
        # Resolve target group for all clients
        target_entities = {}
        for phone, client in list(clients.items()):
            try:
                # Handle join target group first if not joined
                if "t.me/+" in target_group_link or "t.me/joinchat/" in target_group_link:
                    invite_hash = target_group_link.split("+")[-1].split("joinchat/")[-1]
                    try:
                        entity = await client(ImportChatInviteRequest(invite_hash))
                        target_entities[phone] = entity.chats[0]
                    except Exception:
                        # try normal get entity if already joined
                        target_entities[phone] = await client.get_entity(target_group_link)
                else:
                    entity = await client.get_entity(target_group_link)
                    # Try to join just in case
                    try:
                        await client(JoinChannelRequest(entity))
                    except Exception:
                        pass
                    target_entities[phone] = entity
            except Exception as e:
                if log_callback:
                    await log_callback(f"{phone} hesabı hedef grubu çözemedi veya katılamadı: {str(e)}")
                clients.pop(phone, None)
                account_status.pop(phone, None)
                
        if not clients:
            raise ValueError("Hedef gruba erişebilen aktif hesap kalmadı.")
            
        member_index = 0
        active_phones = list(clients.keys())
        
        try:
            while member_index < len(all_members) and active_phones:
                # Rotate phone
                phone = active_phones[member_index % len(active_phones)]
                client = clients[phone]
                target_entity = target_entities[phone]
                
                member = all_members[member_index]
                username = member["username"]
                user_id = member["user_id"]
                identifier = f"@{username}" if username else user_id
                
                if log_callback:
                    await log_callback(f"[{phone}] -> {identifier} grubuna ekleniyor...")
                    
                try:
                    # Resolve input user
                    user_to_add = await client.get_input_entity(f"@{username}" if username else int(user_id))
                    await client(InviteToChannelRequest(target_entity, [user_to_add]))
                    
                    db.update_member_status(user_id, "added")
                    account_status[phone] += 1
                    if log_callback:
                        await log_callback(f"Başarılı: {identifier} gruba eklendi. (Hesap Limiti: {account_status[phone]}/{daily_limit_per_acc})")
                except UserPrivacyRestrictedError:
                    db.update_member_status(user_id, "failed_privacy")
                    if log_callback:
                        await log_callback(f"Atlandı (Gizlilik Kısıtlaması): {identifier}")
                except PeerFloodError:
                    db.update_account_status(phone, "restricted_flood")
                    if log_callback:
                        await log_callback(f"Hesap kısıtlandı (Flood): {phone} rotasyondan çıkarılıyor.")
                    active_phones.remove(phone)
                except FloodWaitError as e:
                    flood_until = int(time.time()) + e.seconds
                    db.update_account_status(phone, "flood_wait", flood_until)
                    if log_callback:
                        await log_callback(f"Hesap beklemeye alındı ({e.seconds}s): {phone} rotasyondan çıkarılıyor.")
                    active_phones.remove(phone)
                except Exception as e:
                    db.update_member_status(user_id, f"error_{str(e)[:50]}")
                    if log_callback:
                        await log_callback(f"Hata ({identifier}): {str(e)}")
                        
                # Check daily limit
                if phone in account_status and account_status[phone] >= daily_limit_per_acc:
                    if log_callback:
                        await log_callback(f"Hesap günlük limitine ulaştı: {phone} rotasyondan çıkarılıyor.")
                    if phone in active_phones:
                        active_phones.remove(phone)
                
                member_index += 1
                
                if active_phones and member_index < len(all_members):
                    # Random delay
                    delay = random.randint(min_delay, max_delay)
                    if log_callback:
                        await log_callback(f"{delay} saniye bekleniyor...")
                    await asyncio.sleep(delay)
                    
            if log_callback:
                await log_callback("Ekleme işlemi tamamlandı.")
        finally:
            pass

    @staticmethod
    async def send_bulk_messages(targets, message_text, phones_to_use, min_delay, max_delay, daily_limit_per_acc, log_callback=None):
        if not phones_to_use:
            raise ValueError("Kullanılacak hesap seçilmedi.")
            
        if not targets:
            raise ValueError("Mesaj gönderilecek hedef bulunamadı.")
            
        if log_callback:
            await log_callback(f"Toplam {len(targets)} hedefe mesaj gönderme işlemi başlıyor...")
            
        clients = {}
        account_status = {}
        
        for phone in phones_to_use:
            acc = next((a for a in db.get_accounts() if a["phone"] == phone), None)
            if acc and acc["status"] == "active":
                client = await TelegramManager.ensure_connected(acc)
                if await client.is_user_authorized():
                    clients[phone] = client
                    account_status[phone] = 0
                else:
                    db.update_account_status(phone, "need_login")
                    
        if not clients:
            raise ValueError("Kullanılabilir aktif hesap kalmadı.")
            
        target_index = 0
        active_phones = list(clients.keys())
        
        try:
            while target_index < len(targets) and active_phones:
                phone = active_phones[target_index % len(active_phones)]
                client = clients[phone]
                
                target = targets[target_index].strip()
                if not target:
                    target_index += 1
                    continue
                    
                if log_callback:
                    await log_callback(f"[{phone}] -> {target} adresine mesaj gönderiliyor...")
                    
                try:
                    await client.send_message(target, message_text)
                    account_status[phone] += 1
                    if log_callback:
                        await log_callback(f"Başarılı: {target} adresine gönderildi. (Hesap Limiti: {account_status[phone]}/{daily_limit_per_acc})")
                except PeerFloodError:
                    db.update_account_status(phone, "restricted_flood")
                    if log_callback:
                        await log_callback(f"Hesap kısıtlandı (Flood): {phone} rotasyondan çıkarılıyor.")
                    active_phones.remove(phone)
                except FloodWaitError as e:
                    flood_until = int(time.time()) + e.seconds
                    db.update_account_status(phone, "flood_wait", flood_until)
                    if log_callback:
                        await log_callback(f"Hesap beklemeye alındı ({e.seconds}s): {phone} rotasyondan çıkarılıyor.")
                    active_phones.remove(phone)
                except Exception as e:
                    if log_callback:
                        await log_callback(f"Hata ({target}): {str(e)}")
                        
                # Check daily limit
                if phone in account_status and account_status[phone] >= daily_limit_per_acc:
                    if log_callback:
                        await log_callback(f"Hesap günlük limitine ulaştı: {phone} rotasyondan çıkarılıyor.")
                    if phone in active_phones:
                        active_phones.remove(phone)
                        
                target_index += 1
                
                if active_phones and target_index < len(targets):
                    delay = random.randint(min_delay, max_delay)
                    if log_callback:
                        await log_callback(f"{delay} saniye bekleniyor...")
                    await asyncio.sleep(delay)
                    
            if log_callback:
                await log_callback("Mesaj gönderme işlemi tamamlandı.")
        finally:
            pass

    @staticmethod
    async def get_joined_chats_for_phone(phone):
        acc = next((a for a in db.get_accounts() if a["phone"] == phone), None)
        if not acc:
            raise ValueError("Hesap bulunamadı.")
        client = await TelegramManager.ensure_connected(acc)
        if not await client.is_user_authorized():
            raise ValueError("Hesap yetkilendirilmemiş.")
        try:
            chats = []
            async for dialog in client.iter_dialogs():
                if dialog.is_group or dialog.is_channel:
                    chats.append({
                        "id": dialog.id,
                        "title": dialog.name,
                        "username": getattr(dialog.entity, 'username', None)
                    })
            return chats
        finally:
            pass

