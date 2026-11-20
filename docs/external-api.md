# Research Hub API cho hệ thống tích hợp

Tài liệu này mô tả các API Worker để hệ thống khác có thể tạo/lưu trữ project, liệt kê file theo project, upload, gắn file cũ vào project, download và xóa file.

## Base URL

| Môi trường | URL |
|---|---|
| Production | `https://research-hub-files.hyperdatalab.workers.dev` |
| Local Worker | `http://127.0.0.1:8787` |

OpenAPI đầy đủ nằm tại [`worker/openapi.yaml`](../worker/openapi.yaml), có thể import vào Postman.

## Xác thực

Mọi endpoint cần header:

```http
Authorization: Bearer <SSO_ACCESS_TOKEN>
```

Token phải được cấp bởi HyperDataLab SSO cho người dùng có email `@hyperdatalab.org` đã xác minh. SSO client phải được admin cấp các scope `email`, `profile` và `hyperdatalab_profile`; scope cuối cung cấp claim `role`. Worker xác thực token bằng `/oauth/userinfo` ở mỗi request và cô lập dữ liệu theo SSO `sub`.

API hiện dùng token người dùng theo OAuth Authorization Code + PKCE; chưa hỗ trợ API key hoặc client-credentials/service token. Vì vậy hệ thống gọi API phải có access token của người dùng. Không gửi token trong query string hoặc ghi token vào log.

Các lời gọi từ trình duyệt cần thêm origin của frontend vào `ALLOWED_ORIGINS`. Lời gọi backend-to-backend không cần cấu hình CORS.

## Project

### Liệt kê project

```http
GET /api/projects
```

Trả tối đa 100 project thuộc SSO subject hiện tại, mới cập nhật trước. Project đã lưu trữ bị ẩn theo mặc định; thêm `?includeDeleted=true` để lấy cả project lưu trữ. Chưa có chia sẻ project.

```bash
curl "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "items": [
    {
      "id": "6be3195a-3690-4972-ac51-e6980b24a909",
      "name": "AI trong nghiên cứu Sinh học",
      "description": "Nghiên cứu tác động của AI",
      "createdAt": "2026-11-18T10:00:00.000Z",
      "updatedAt": "2026-11-18T10:00:00.000Z",
      "deletedAt": null
    }
  ]
}
```

### Tạo project

```http
POST /api/projects
Content-Type: application/json
```

`name` bắt buộc, tối đa 120 ký tự; `description` tùy chọn, tối đa 1000 ký tự.

```bash
curl -X POST "$BASE_URL/api/projects" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"AI trong nghiên cứu Sinh học","description":"Nghiên cứu tác động của AI"}'
```

Trả `201 Created` với `{ "project": { ... } }`.

### Lưu trữ và khôi phục project

```http
DELETE /api/projects/{projectId}
POST   /api/projects/{projectId}/restore
```

`DELETE` lưu trữ mềm project: project bị ẩn khỏi danh sách mặc định và không nhận upload mới. File đang thuộc project vẫn được giữ nguyên, có thể xem và tải xuống. `restore` đưa project về trạng thái hoạt động; các file vẫn gắn với project đó.

```bash
curl -X DELETE "$BASE_URL/api/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X POST "$BASE_URL/api/projects/$PROJECT_ID/restore" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## File

### Liệt kê file

```http
GET /api/files
GET /api/files?cursor=<CURSOR>
```

Mỗi trang có tối đa 100 file. Khi còn trang tiếp theo, response trả cursor; gửi lại cursor đó trong query để lấy trang sau.

```bash
curl "$BASE_URL/api/files" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Response gồm `items` (`id`, `name`, `contentType`, `size`, `uploadedAt`, `projectId`) và `cursor` (string hoặc `null`). Mỗi file mới có một `projectId`; file cũ chưa chuyển đổi có `projectId: null`. Dùng `projectId` phía client để lọc file theo project.

### Upload file

```http
POST /api/files
Authorization: Bearer <SSO_ACCESS_TOKEN>
Content-Type: <file MIME type>
X-File-Name: <URL-encoded filename>
X-Project-Id: <UUID của project đang hoạt động>

<raw file bytes>
```

Gửi bytes trực tiếp trong body, không dùng `multipart/form-data`. Giới hạn 25 MB mỗi file. Tên file cần URL-encode trong `X-File-Name`.

```bash
curl -X POST "$BASE_URL/api/files" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/pdf" \
  -H "X-File-Name: Bao%20cao.pdf" \
  -H "X-Project-Id: $PROJECT_ID" \
  --data-binary "@./Bao cao.pdf"
```

`X-Project-Id` là bắt buộc. Worker kiểm tra project thuộc người dùng hiện tại và chưa được lưu trữ. Thiếu/sai UUID trả `400`, project không tồn tại hoặc không thuộc user trả `404`, project lưu trữ trả `409`. Trả `201 Created` với `{ "item": { "id", "name", "contentType", "size", "uploadedAt", "projectId" } }`.

### Gắn hoặc chuyển file sang project khác

```http
PUT /api/files/{fileId}/project
Content-Type: application/json
```

Dùng endpoint này để chuyển từng file cũ chưa có project hoặc đổi project của file. Project đích phải đang hoạt động và thuộc user hiện tại.

```bash
curl -X PUT "$BASE_URL/api/files/$FILE_ID/project" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"
```

Trả `200 OK` với `{ "item": { ... } }`. Không có endpoint để gỡ liên kết; mỗi file cần thuộc đúng một project sau khi chuyển đổi.

### Download file

```http
GET /api/files/{id}
```

Trả bytes của file với `Content-Disposition: attachment`, không phải JSON.

```bash
curl "$BASE_URL/api/files/$FILE_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --output ./downloaded-file
```

File không tồn tại hoặc không thuộc user hiện tại trả `404`.

### Xóa file

```http
DELETE /api/files/{id}
```

Trả `200 OK` với `{ "ok": true }`.

```bash
curl -X DELETE "$BASE_URL/api/files/$FILE_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Cấu hình tool (admin)

`GET /api/tool-settings` đọc URL PaperLab/Writing Lab. `PUT /api/tool-settings` cập nhật cấu hình và chỉ chấp nhận người dùng có claim SSO `role=ADMIN` (không phân biệt hoa thường).

```http
PUT /api/tool-settings
Content-Type: application/json
```

```json
{
  "paperLabUrl": "https://paperlab.example.org",
  "writingLabUrl": "https://writing.example.org"
}
```

## Lỗi phổ biến

| HTTP | Ý nghĩa |
|---|---|
| `400` | JSON hoặc input không hợp lệ |
| `401` | Token thiếu, hết hạn hoặc không hợp lệ |
| `403` | Email không thuộc tổ chức/không xác minh, thiếu quyền admin, hoặc browser origin chưa được cho phép |
| `404` | File/route không tìm thấy |
| `413` | File lớn hơn 25 MB |
| `500` | Lỗi xử lý phía Worker hoặc storage |
| `502` | Không xác minh được token với SSO hoặc lỗi dịch vụ phụ thuộc |
| `503` | Cấu hình/quyền Firestore của Worker chưa sẵn sàng |

Lỗi JSON có dạng `{ "error": "..." }` khi Worker trả JSON. Token OAuth có thời hạn một giờ; API hiện không cấp refresh token.
