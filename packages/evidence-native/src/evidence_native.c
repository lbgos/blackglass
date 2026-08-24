// Blackglass evidence publication native boundary.
//
// Exposes exactly two descriptor-relative operations that Node's public fs
// API cannot express: openat(2) and renameat2(2) with RENAME_NOREPLACE.
// No policy lives here. Callers pass pre-validated single path segments and
// directory descriptors; errno is returned as data so TypeScript maps it to
// the ADR-0003 fail-closed error codes.
#define NAPI_VERSION 8
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <node_api.h>
#include <stdio.h>
#include <string.h>

#define MAX_SEGMENT_BYTES 256

static napi_value make_ok_fd(napi_env env, int fd) {
  napi_value result, value;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_get_boolean(env, true, &value) != napi_ok ||
      napi_set_named_property(env, result, "ok", value) != napi_ok ||
      napi_create_int32(env, fd, &value) != napi_ok ||
      napi_set_named_property(env, result, "fd", value) != napi_ok) {
    return NULL;
  }
  return result;
}

static napi_value make_errno_result(napi_env env, bool ok, int err) {
  napi_value result, value;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_get_boolean(env, ok, &value) != napi_ok ||
      napi_set_named_property(env, result, "ok", value) != napi_ok ||
      napi_create_int32(env, err, &value) != napi_ok ||
      napi_set_named_property(env, result, "errno", value) != napi_ok) {
    return NULL;
  }
  return result;
}

static napi_value throw_argument_error(napi_env env, const char* message) {
  napi_value code, error;
  if (napi_create_string_utf8(env, "ERR_INVALID_ARG_VALUE", NAPI_AUTO_LENGTH, &code) != napi_ok ||
      napi_create_string_utf8(env, message, NAPI_AUTO_LENGTH, &error) != napi_ok) {
    return NULL;
  }
  napi_value exception;
  if (napi_create_type_error(env, code, error, &exception) != napi_ok) return NULL;
  napi_throw(env, exception);
  return NULL;
}

// Reads one string argument and rejects anything that cannot be a single
// relative path segment: empty, too long, containing NUL or '/'.
static int read_segment(napi_env env, napi_value value, char* out, size_t out_size) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) return -1;
  if (length == 0 || length >= out_size) return -1;
  if (napi_get_value_string_utf8(env, value, out, out_size, &length) != napi_ok) return -1;
  if (length == 0) return -1;
  // Embedded NUL would truncate the segment; the terminator at out[length]
  // is expected and excluded here.
  if (memchr(out, '\0', length) != NULL) return -1;
  for (size_t index = 0; index < length; index += 1) {
    if (out[index] == '/') return -1;
  }
  // Reject "." and ".." outright: relative-parent traversal is never a
  // legitimate managed-tree name.
  if (out[0] == '.' && (length == 1 || (length == 2 && out[1] == '.'))) return -1;
  return 0;
}

static napi_value open_at(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 4) {
    return throw_argument_error(env, "openAt requires (dirfd, name, flags, mode)");
  }

  int32_t dirfd = 0;
  int32_t flags = 0;
  int32_t mode = 0;
  char name[MAX_SEGMENT_BYTES];
  if (napi_get_value_int32(env, argv[0], &dirfd) != napi_ok ||
      read_segment(env, argv[1], name, sizeof(name)) != 0 ||
      napi_get_value_int32(env, argv[2], &flags) != napi_ok ||
      napi_get_value_int32(env, argv[3], &mode) != napi_ok) {
    return throw_argument_error(env, "openAt arguments must be (int fd, short relative segment, int flags, int mode)");
  }

  int fd = openat((int)dirfd, name, (int)flags, (mode_t)mode);
  if (fd < 0) return make_errno_result(env, false, errno);
  return make_ok_fd(env, fd);
}

static napi_value rename_no_replace(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc < 4) {
    return throw_argument_error(env, "renameNoReplace requires (oldDirfd, oldName, newDirfd, newName)");
  }

  int32_t old_dirfd = 0;
  int32_t new_dirfd = 0;
  char old_name[MAX_SEGMENT_BYTES];
  char new_name[MAX_SEGMENT_BYTES];
  if (napi_get_value_int32(env, argv[0], &old_dirfd) != napi_ok ||
      read_segment(env, argv[1], old_name, sizeof(old_name)) != 0 ||
      napi_get_value_int32(env, argv[2], &new_dirfd) != napi_ok ||
      read_segment(env, argv[3], new_name, sizeof(new_name)) != 0) {
    return throw_argument_error(env, "renameNoReplace arguments must be (int dirfd, short relative segment, int dirfd, short relative segment)");
  }

  if (renameat2((int)old_dirfd, old_name, (int)new_dirfd, new_name, RENAME_NOREPLACE) != 0) {
    return make_errno_result(env, false, errno);
  }
  return make_errno_result(env, true, 0);
}

static napi_value create_function(napi_env env, const char* name, napi_callback callback) {
  napi_value function;
  if (napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, NULL, &function) != napi_ok) {
    return NULL;
  }
  return function;
}

NAPI_MODULE_INIT() {
  napi_value open_at_function = create_function(env, "openAt", open_at);
  napi_value rename_function = create_function(env, "renameNoReplace", rename_no_replace);
  if (open_at_function == NULL || rename_function == NULL) return NULL;
  if (napi_set_named_property(env, exports, "openAt", open_at_function) != napi_ok ||
      napi_set_named_property(env, exports, "renameNoReplace", rename_function) != napi_ok) {
    return NULL;
  }
  return exports;
}
