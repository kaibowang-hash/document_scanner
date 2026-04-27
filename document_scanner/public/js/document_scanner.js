// Copyright (c) 2026, JCE
// MIT License. See license.txt

(() => {
	"use strict";

	const OPTION_NAME = "document_scanner";
	const LIB_ASSETS = [
		"/assets/document_scanner/vendor/jspdf/jspdf.umd.min.js",
		"/assets/document_scanner/vendor/cropperjs/cropper.min.css",
		"/assets/document_scanner/vendor/cropperjs/cropper.min.js",
	];
	const MAX_IMAGE_WIDTH = 2480;
	const MAX_IMAGE_HEIGHT = 3508;
	const SCANNER_ICON = `
		<circle cx="15" cy="15" r="15" fill="var(--subtle-fg)"></circle>
		<path d="M9 10V8.5C9 8.2 9.2 8 9.5 8h11c.3 0 .5.2.5.5V10" stroke="var(--text-color)" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>
		<rect x="7.5" y="12" width="15" height="8.5" rx="1.5" stroke="var(--text-color)" fill="none"></rect>
		<path d="M10.5 15.5h.01M11 20.5v1h8v-1" stroke="var(--text-color)" stroke-linecap="round" stroke-linejoin="round"></path>
	`;

	let libs_promise = null;

	frappe.ready(() => {
		wait_for_file_uploader();
	});

	function wait_for_file_uploader() {
		if (install_scanner_bridge()) return;

		if (frappe.require) {
			frappe.require("file_uploader.bundle.js", () => install_scanner_bridge());
		}

		const started_at = Date.now();
		const timer = setInterval(() => {
			if (install_scanner_bridge() || Date.now() - started_at > 10000) {
				clearInterval(timer);
			}
		}, 100);
	}

	function install_scanner_bridge() {
		if (!frappe.ui || !frappe.ui.FileUploader) return false;
		if (frappe.ui.FileUploader.__document_scanner_bridge) return true;

		const OriginalFileUploader = frappe.ui.FileUploader;
		const supports_upload_options = Array.isArray(OriginalFileUploader.UploadOptions);

		class DocumentScannerFileUploader extends OriginalFileUploader {
			constructor(options = {}) {
				if (supports_upload_options) {
					sync_upload_options(DocumentScannerFileUploader, OriginalFileUploader, options);
				}

				super(options);

				this.document_scanner_upload_options = options;

				if (this.uploader) {
					this.uploader.document_scanner_upload_options = options;
					this.uploader.document_scanner_file_uploader = this;
				}

				if (!supports_upload_options && should_show_scan_option(options)) {
					inject_v15_scan_button(this, options);
				}
			}
		}

		if (supports_upload_options) {
			DocumentScannerFileUploader.UploadOptions = without_scan_option(
				OriginalFileUploader.UploadOptions || []
			);
		}
		DocumentScannerFileUploader.__document_scanner_bridge = true;
		DocumentScannerFileUploader.__document_scanner_original = OriginalFileUploader;

		frappe.ui.FileUploader = DocumentScannerFileUploader;

		window.document_scanner = {
			open: (upload_context = {}) => {
				const normalized_context = normalize_upload_context(upload_context);
				open_scanner(normalized_context, null);
			},
		};

		return true;
	}

	function sync_upload_options(WrappedFileUploader, OriginalFileUploader, options) {
		const current_options = Array.isArray(WrappedFileUploader.UploadOptions)
			? WrappedFileUploader.UploadOptions
			: OriginalFileUploader.UploadOptions || [];
		const base_options = without_scan_option(current_options);

		WrappedFileUploader.UploadOptions = should_show_scan_option(options)
			? [...base_options, make_upload_option()]
			: base_options;
	}

	function without_scan_option(options) {
		return (options || []).filter((option) => option && option.name !== OPTION_NAME);
	}

	function make_upload_option() {
		return {
			name: OPTION_NAME,
			label: __("Scan"),
			icon: SCANNER_ICON,
			action: open_scanner_from_upload_option,
		};
	}

	function open_scanner_from_upload_option({ dialog, uploader, doctype, docname, fieldname }) {
		const uploader_options = uploader?.document_scanner_upload_options || {};
		const upload_context = normalize_upload_context({
			...uploader_options,
			doctype,
			docname,
			fieldname,
		});
		const file_uploader = uploader?.document_scanner_file_uploader || null;

		if (dialog) {
			dialog.hide();
		}

		open_scanner(upload_context, file_uploader);
	}

	function inject_v15_scan_button(file_uploader, options) {
		const started_at = Date.now();
		let observer = null;

		const try_inject = () => {
			const wrapper = file_uploader.wrapper;
			if (!wrapper || !document.body.contains(wrapper)) return false;

			const $wrapper = $(wrapper);
			if ($wrapper.find(".document-scanner-upload-option").length) return true;

			const $button_group = $wrapper
				.find(".file-upload-area .text-center")
				.filter(function () {
					return $(this).find(".btn-file-upload").length > 0;
				})
				.first();

			if (!$button_group.length) return false;

			const $button = $(`
				<button class="btn btn-file-upload document-scanner-upload-option" type="button">
					<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
						${SCANNER_ICON}
					</svg>
					<div class="mt-1">${__("Scan")}</div>
				</button>
			`);

			$button.on("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				file_uploader.dialog?.hide();
				open_scanner(normalize_upload_context(options), file_uploader);
			});

			$button_group.append($button);
			return true;
		};

		if (try_inject()) return;

		observer = new MutationObserver(() => {
			if (try_inject() || Date.now() - started_at > 10000) {
				observer.disconnect();
			}
		});
		observer.observe(file_uploader.wrapper, { childList: true, subtree: true });

		setTimeout(() => observer.disconnect(), 10000);
	}

	function should_show_scan_option(options = {}) {
		if (options.as_dataurl) return false;
		if (options.restrictions?.max_number_of_files === 0) return false;
		return allowed_file_types_allow_pdf(options.restrictions?.allowed_file_types);
	}

	function allowed_file_types_allow_pdf(allowed_file_types) {
		if (!allowed_file_types || allowed_file_types.length === 0) return true;

		const types = Array.isArray(allowed_file_types)
			? allowed_file_types
			: String(allowed_file_types).split(",");

		return types.some((type) => {
			const normalized = String(type || "").trim().toLowerCase();
			return (
				normalized === ".pdf" ||
				normalized === "pdf" ||
				normalized === "application/pdf" ||
				normalized === "application/*" ||
				normalized === "*/*"
			);
		});
	}

	function open_scanner(upload_context, file_uploader) {
		if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
			frappe.msgprint(__("当前浏览器不支持摄像头扫描。"));
			return;
		}

		ensure_scanner_libs()
			.then(() => open_scanner_dialog(upload_context, file_uploader))
			.catch((error) => {
				frappe.msgprint({
					title: __("扫描器加载失败"),
					indicator: "red",
					message: error.message || String(error),
				});
			});
	}

	function normalize_upload_context(context = {}) {
		const frm = context.frm || find_current_form(context);
		const can_upload_public = Boolean(frappe.utils?.can_upload_public_files?.());
		const make_public = Boolean(context.make_attachments_public && can_upload_public);

		return {
			doctype: context.doctype || frm?.doctype || frm?.doc?.doctype || null,
			docname: context.docname || frm?.docname || frm?.doc?.name || null,
			fieldname: context.fieldname || null,
			folder: context.folder || "Home",
			method: context.method || null,
			on_success: context.on_success || null,
			restrictions: context.restrictions || {},
			make_attachments_public: context.make_attachments_public,
			default_private: make_public ? 0 : 1,
			can_upload_public,
			frm,
		};
	}

	function find_current_form(context = {}) {
		if (context.frm) return context.frm;
		if (!window.cur_frm) return null;
		if (!context.doctype && !context.docname) return window.cur_frm;
		if (context.doctype && context.doctype !== window.cur_frm.doctype) return null;
		if (context.docname && context.docname !== window.cur_frm.docname) return null;
		return window.cur_frm;
	}

	function ensure_scanner_libs() {
		if (window.jspdf?.jsPDF && window.Cropper) {
			return Promise.resolve();
		}

		if (libs_promise) return libs_promise;

		libs_promise = new Promise((resolve, reject) => {
			frappe.require(LIB_ASSETS, () => {
				if (window.jspdf?.jsPDF && window.Cropper) {
					resolve();
				} else {
					reject(new Error(__("jsPDF 或 CropperJS 未能加载。")));
				}
			});
		});

		return libs_promise;
	}

	function open_scanner_dialog(upload_context, file_uploader) {
		const state = {
			uid: `document_scan_${Date.now()}`,
			stream: null,
			cropper: null,
			scanned_pages: [],
			preview_applied: false,
			suspend_dirty_flag: false,
			current_capture_url: null,
			uploading: false,
		};

		let $root = null;

		const dialog = new frappe.ui.Dialog({
			title: __("扫描纸质单据"),
			size: "extra-large",
			fields: [{ fieldtype: "HTML", fieldname: "scanner_ui" }],
			primary_action_label: __("合成 PDF 并归档"),
			primary_action: async () => {
				if (!state.scanned_pages.length) {
					frappe.msgprint(__("请至少拍摄并确认一页文件。"));
					return;
				}

				await generate_and_upload_pdf({
					dialog,
					state,
					$root,
					upload_context,
					file_uploader,
				});
			},
		});

		dialog.get_field("scanner_ui").$wrapper.html(get_scanner_html(state.uid, upload_context));
		dialog.show();

		$root = dialog.get_field("scanner_ui").$wrapper.find(`#${state.uid}`);

		const video = $root.find('[data-role="video"]')[0];
		const crop_image = $root.find('[data-role="crop-image"]')[0];
		const hidden_canvas = $root.find('[data-role="hidden-canvas"]')[0];
		const $gallery = $root.find('[data-role="gallery"]');
		const $status = $root.find('[data-role="status"]');

		bind_param_events($root, state);
		apply_preset_to_controls($root, "bw_standard");
		update_range_labels($root);
		update_counts($root, state);
		update_primary_state(dialog, state);
		start_camera(video, state, $status);

		dialog.$wrapper.on("hide.bs.modal", () => cleanup_scanner(state));

		$root.on("click", '[data-action="close"]', () => dialog.hide());
		$root.on("click", '[data-action="shoot"]', () =>
			capture_current_page({ state, video, hidden_canvas, crop_image, $root, $status })
		);
		$root.on("click", '[data-action="retake"]', () => {
			destroy_cropper(state);
			state.preview_applied = false;
			$root.removeClass("mode-crop").addClass("mode-capture");
			$status.text(__("实时取景中"));
		});
		$root.on("click", '[data-action="rotate_left"]', () => rotate_cropper(state, -90));
		$root.on("click", '[data-action="rotate_right"]', () => rotate_cropper(state, 90));
		$root.on("click", '[data-action="reset_crop"]', () => {
			if (!state.cropper) return;
			state.preview_applied = false;
			state.cropper.reset();
			apply_aspect_ratio(state.cropper, read_scan_params($root).aspect_ratio);
		});
		$root.on("click", '[data-action="apply_filter"]', () => apply_filter($root, state));
		$root.on("click", '[data-action="confirm"]', async () => {
			await confirm_current_page({ dialog, state, $root, $gallery, $status });
		});
		$root.on("click", ".document-scan-thumb-remove", function () {
			if (state.uploading) return;
			const idx = Number($(this).attr("data-index"));
			if (Number.isInteger(idx) && idx >= 0 && idx < state.scanned_pages.length) {
				const [removed] = state.scanned_pages.splice(idx, 1);
				revoke_url(removed?.url);
				render_gallery($gallery, state);
				update_counts($root, state);
				update_primary_state(dialog, state);
			}
		});
	}

	function get_scanner_html(uid, upload_context) {
		const target_label = get_target_label(upload_context);
		const private_checked = upload_context.default_private ? "checked" : "";
		const private_disabled = upload_context.can_upload_public ? "" : "disabled";

		return `
			<style>
				#${uid} { border: 1px solid var(--border-color, #d1d8dd); border-radius: 8px; background: var(--card-bg, #fff); overflow: hidden; }
				#${uid} * { box-sizing: border-box; }
				#${uid} .document-scan-head { padding: 12px 14px; border-bottom: 1px solid var(--border-color, #d1d8dd); background: var(--subtle-fg, #f7f7f7); }
				#${uid} .document-scan-head-title { font-size: 15px; font-weight: 600; color: var(--text-color, #1f272e); margin-bottom: 4px; }
				#${uid} .document-scan-head-sub { font-size: 12px; color: var(--text-muted, #6c7680); word-break: break-all; }
				#${uid} .document-scan-stage { padding: 12px; background: var(--fg-color, #fafbfc); border-bottom: 1px solid var(--border-color, #d1d8dd); }
				#${uid} .document-scan-viewport { position: relative; width: 100%; min-height: 300px; height: min(52vh, 520px); border: 1px solid var(--border-color, #d1d8dd); border-radius: 8px; background: #eef1f4; overflow: hidden; display: flex; align-items: center; justify-content: center; }
				#${uid} .document-scan-video, #${uid} .document-scan-crop-image { width: 100%; height: 100%; object-fit: contain; display: block; }
				#${uid} .document-scan-crop-wrap { width: 100%; height: 100%; display: none; }
				#${uid} .document-scan-crop-image { display: none; }
				#${uid} .document-scan-guide { position: absolute; top: 8%; left: 10%; right: 10%; bottom: 8%; border: 2px dashed rgba(0, 0, 0, 0.16); border-radius: 8px; pointer-events: none; }
				#${uid} .document-scan-status { position: absolute; left: 12px; bottom: 12px; padding: 4px 8px; font-size: 12px; color: #555; background: rgba(255,255,255,0.94); border: 1px solid #dcdfe4; border-radius: 6px; }
				#${uid} .document-scan-params { padding: 12px; border-top: 1px solid var(--border-color, #d1d8dd); background: var(--card-bg, #fff); }
				#${uid} .document-scan-param-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px 12px; }
				#${uid} .document-scan-param-item label { display: block; margin-bottom: 4px; font-size: 12px; color: #61707f; font-weight: 500; }
				#${uid} .document-scan-param-item select, #${uid} .document-scan-param-item input[type="range"] { width: 100%; }
				#${uid} .document-scan-range-row { display: flex; align-items: center; gap: 8px; }
				#${uid} .document-scan-range-row input[type="range"] { flex: 1; min-width: 0; }
				#${uid} .document-scan-range-value { min-width: 34px; text-align: right; font-size: 12px; color: #4b5563; font-weight: 600; }
				#${uid} .document-scan-check-row { display: flex; align-items: center; gap: 8px; min-height: 34px; padding-top: 22px; }
				#${uid} .document-scan-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; padding: 12px; border-top: 1px solid var(--border-color, #d1d8dd); background: var(--card-bg, #fff); }
				#${uid} .document-scan-toolbar-left, #${uid} .document-scan-toolbar-center, #${uid} .document-scan-toolbar-right { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
				#${uid} .document-scan-counter { font-size: 13px; color: var(--text-muted, #6c7680); white-space: nowrap; }
				#${uid} .document-scan-gallery-wrap { padding: 12px; background: var(--card-bg, #fff); }
				#${uid} .document-scan-gallery-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
				#${uid} .document-scan-gallery-title { font-size: 14px; font-weight: 600; color: var(--text-color, #1f272e); }
				#${uid} .document-scan-gallery { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; min-height: 110px; }
				#${uid} .document-scan-empty { width: 100%; min-height: 90px; border: 1px dashed #d1d8dd; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #7b8794; background: var(--fg-color, #fafbfc); }
				#${uid} .document-scan-thumb { width: 84px; min-width: 84px; }
				#${uid} .document-scan-thumb-box { position: relative; width: 84px; height: 108px; border: 1px solid #d1d8dd; border-radius: 6px; overflow: hidden; background: #f7f7f7; }
				#${uid} .document-scan-thumb-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
				#${uid} .document-scan-thumb-no { margin-top: 4px; font-size: 11px; color: #6c7680; text-align: center; }
				#${uid} .document-scan-thumb-remove { position: absolute; right: 4px; top: 4px; width: 20px; height: 20px; border: 1px solid #d1d8dd; background: rgba(255,255,255,0.96); border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 18px; text-align: center; color: #666; padding: 0; }
				#${uid}.mode-capture [data-role="crop-controls"] { display: none !important; }
				#${uid}.mode-capture .document-scan-crop-wrap { display: none !important; }
				#${uid}.mode-crop [data-role="capture-controls"], #${uid}.mode-crop .document-scan-video, #${uid}.mode-crop .document-scan-guide { display: none !important; }
				#${uid}.mode-crop .document-scan-crop-wrap, #${uid}.mode-crop .document-scan-crop-image { display: block !important; }
				#${uid}.is-busy button { pointer-events: none; opacity: 0.65; }
				@media (max-width: 768px) {
					#${uid} .document-scan-viewport { min-height: 230px; height: 42vh; }
					#${uid} .document-scan-toolbar-left, #${uid} .document-scan-toolbar-center, #${uid} .document-scan-toolbar-right { width: 100%; }
					#${uid} .document-scan-toolbar-right { justify-content: flex-start; }
				}
			</style>

			<div id="${uid}" class="mode-capture">
				<div class="document-scan-head">
					<div class="document-scan-head-title">${__("文件扫描归档")}</div>
					<div class="document-scan-head-sub">${escape_html(target_label)}</div>
				</div>
				<div class="document-scan-stage">
					<div class="document-scan-viewport">
						<video class="document-scan-video" data-role="video" autoplay playsinline></video>
						<div class="document-scan-guide"></div>
						<div class="document-scan-crop-wrap"><img class="document-scan-crop-image" data-role="crop-image" alt=""></div>
						<div class="document-scan-status" data-role="status">${__("正在启动摄像头...")}</div>
					</div>
					<div class="document-scan-params">
						<div class="document-scan-param-grid">
							<div class="document-scan-param-item">
								<label>${__("增强预设")}</label>
								<select class="form-control" data-field="enhance_preset">
									<option value="original">${__("原图")}</option>
									<option value="bw_standard" selected>${__("标准黑白")}</option>
									<option value="bw_strong">${__("强力黑白")}</option>
									<option value="receipt">${__("票据模式")}</option>
									<option value="light_text">${__("浅底文字")}</option>
								</select>
							</div>
							<div class="document-scan-param-item">
								<label>${__("裁剪比例")}</label>
								<select class="form-control" data-field="aspect_ratio">
									<option value="free" selected>${__("自由比例")}</option>
									<option value="a4_portrait">${__("A4 竖版")}</option>
									<option value="a4_landscape">${__("A4 横版")}</option>
									<option value="receipt_long">${__("长票据")}</option>
								</select>
							</div>
							<div class="document-scan-param-item">
								<label>${__("JPEG 质量")}</label>
								<select class="form-control" data-field="jpeg_quality">
									<option value="0.80">80%</option>
									<option value="0.85" selected>85%</option>
									<option value="0.92">92%</option>
									<option value="1.00">100%</option>
								</select>
							</div>
							<div class="document-scan-param-item">
								<label>${__("PDF 页面模式")}</label>
								<select class="form-control" data-field="pdf_mode">
									<option value="a4_portrait" selected>${__("A4 竖版")}</option>
									<option value="a4_landscape">${__("A4 横版")}</option>
									<option value="auto">${__("自动判断")}</option>
								</select>
							</div>
							${range_control("brightness", __("亮度"), -40, 40, 5)}
							${range_control("contrast", __("对比度"), 0, 100, 35)}
							${range_control("threshold", __("阈值"), 120, 230, 185)}
							${range_control("sharpen", __("锐化"), 0, 60, 15)}
							<div class="document-scan-param-item">
								<div class="document-scan-check-row">
									<input type="checkbox" data-field="white_bg" checked>
									<label style="margin:0;">${__("白底净化")}</label>
								</div>
							</div>
							<div class="document-scan-param-item">
								<div class="document-scan-check-row">
									<input type="checkbox" data-field="is_private" ${private_checked} ${private_disabled}>
									<label style="margin:0;">${__("私有附件")}</label>
								</div>
							</div>
						</div>
					</div>
					<div class="document-scan-toolbar" data-role="capture-controls">
						<div class="document-scan-toolbar-left"><button class="btn btn-default" data-action="close">${__("关闭")}</button></div>
						<div class="document-scan-toolbar-center"><button class="btn btn-primary" data-action="shoot" style="min-width: 120px;">${__("拍摄当前页")}</button></div>
						<div class="document-scan-toolbar-right"><span class="document-scan-counter">${__("已确认")}：<strong data-role="page-counter">0</strong> ${__("页")}</span></div>
					</div>
					<div class="document-scan-toolbar" data-role="crop-controls">
						<div class="document-scan-toolbar-left">
							<button class="btn btn-default" data-action="retake">${__("返回重拍")}</button>
							<button class="btn btn-default" data-action="rotate_left">${__("左旋")}</button>
							<button class="btn btn-default" data-action="rotate_right">${__("右旋")}</button>
							<button class="btn btn-default" data-action="reset_crop">${__("重置")}</button>
						</div>
						<div class="document-scan-toolbar-center">
							<button class="btn btn-default" data-action="apply_filter">${__("应用增强")}</button>
							<button class="btn btn-primary" data-action="confirm">${__("确认此页")}</button>
						</div>
						<div class="document-scan-toolbar-right"><span class="document-scan-counter">${__("裁剪或修改参数后，可重新应用增强")}</span></div>
					</div>
				</div>
				<div class="document-scan-gallery-wrap">
					<div class="document-scan-gallery-head">
						<div class="document-scan-gallery-title">${__("已拍页面")}</div>
						<div class="document-scan-counter">${__("共")} <span data-role="gallery-count">0</span> ${__("页")}</div>
					</div>
					<div class="document-scan-gallery" data-role="gallery">
						<div class="document-scan-empty">${__("尚未拍摄任何页面")}</div>
					</div>
				</div>
				<canvas data-role="hidden-canvas" style="display:none;"></canvas>
			</div>
		`;
	}

	function range_control(fieldname, label, min, max, value) {
		return `
			<div class="document-scan-param-item">
				<label>${label}</label>
				<div class="document-scan-range-row">
					<input type="range" min="${min}" max="${max}" step="1" value="${value}" data-field="${fieldname}">
					<span class="document-scan-range-value" data-value-for="${fieldname}">${value}</span>
				</div>
			</div>
		`;
	}

	function get_target_label(upload_context) {
		if (upload_context.doctype && upload_context.docname) {
			const field_label = upload_context.fieldname
				? ` / ${__("字段")}: ${upload_context.fieldname}`
				: ` / ${__("单据附件")}`;
			return `${__("归档目标")}: ${__(upload_context.doctype)} ${upload_context.docname}${field_label}`;
		}

		return `${__("归档目标")}: ${__("文件夹")} ${upload_context.folder || "Home"}`;
	}

	function bind_param_events($root, state) {
		$root.on(
			"input change",
			'[data-field="brightness"], [data-field="contrast"], [data-field="threshold"], [data-field="sharpen"]',
			() => {
				update_range_labels($root);
				state.preview_applied = false;
			}
		);

		$root.on(
			"change",
			'[data-field="white_bg"], [data-field="jpeg_quality"], [data-field="pdf_mode"]',
			() => {
				state.preview_applied = false;
			}
		);

		$root.on("change", '[data-field="enhance_preset"]', function () {
			apply_preset_to_controls($root, $(this).val());
			update_range_labels($root);
			state.preview_applied = false;
		});

		$root.on("change", '[data-field="aspect_ratio"]', function () {
			state.preview_applied = false;
			if (state.cropper) {
				apply_aspect_ratio(state.cropper, $(this).val());
			}
		});
	}

	function apply_preset_to_controls($root, preset_key) {
		const preset = get_scan_preset_defaults(preset_key);
		$root.find('[data-field="brightness"]').val(preset.brightness);
		$root.find('[data-field="contrast"]').val(preset.contrast);
		$root.find('[data-field="threshold"]').val(preset.threshold);
		$root.find('[data-field="sharpen"]').val(preset.sharpen);
		$root.find('[data-field="white_bg"]').prop("checked", preset.white_bg);
	}

	function update_range_labels($root) {
		["brightness", "contrast", "threshold", "sharpen"].forEach((field) => {
			const val = $root.find(`[data-field="${field}"]`).val();
			$root.find(`[data-value-for="${field}"]`).text(val);
		});
	}

	function read_scan_params($root) {
		return {
			enhance_preset: $root.find('[data-field="enhance_preset"]').val(),
			aspect_ratio: $root.find('[data-field="aspect_ratio"]').val(),
			jpeg_quality: Number($root.find('[data-field="jpeg_quality"]').val() || 0.85),
			pdf_mode: $root.find('[data-field="pdf_mode"]').val(),
			brightness: Number($root.find('[data-field="brightness"]').val() || 0),
			contrast: Number($root.find('[data-field="contrast"]').val() || 0),
			threshold: Number($root.find('[data-field="threshold"]').val() || 185),
			sharpen: Number($root.find('[data-field="sharpen"]').val() || 0),
			white_bg: $root.find('[data-field="white_bg"]').is(":checked"),
			is_private: $root.find('[data-field="is_private"]').is(":checked") ? 1 : 0,
		};
	}

	function get_scan_preset_defaults(key) {
		const presets = {
			original: { brightness: 0, contrast: 0, threshold: 190, sharpen: 0, white_bg: false },
			bw_standard: { brightness: 5, contrast: 35, threshold: 185, sharpen: 15, white_bg: true },
			bw_strong: { brightness: 8, contrast: 55, threshold: 170, sharpen: 24, white_bg: true },
			receipt: { brightness: 12, contrast: 72, threshold: 155, sharpen: 28, white_bg: true },
			light_text: { brightness: 18, contrast: 50, threshold: 195, sharpen: 20, white_bg: true },
		};
		return presets[key] || presets.bw_standard;
	}

	function apply_aspect_ratio(cropper, mode) {
		if (!cropper) return;
		const ratios = {
			free: NaN,
			a4_portrait: 210 / 297,
			a4_landscape: 297 / 210,
			receipt_long: 80 / 220,
		};
		cropper.setAspectRatio(ratios[mode] !== undefined ? ratios[mode] : NaN);
	}

	function capture_current_page({ state, video, hidden_canvas, crop_image, $root, $status }) {
		if (state.uploading) return;
		if (!video.videoWidth) {
			frappe.msgprint(__("摄像头尚未就绪，请稍候再试。"));
			return;
		}

		hidden_canvas.width = video.videoWidth;
		hidden_canvas.height = video.videoHeight;
		hidden_canvas.getContext("2d").drawImage(video, 0, 0);
		hidden_canvas.toBlob(
			(blob) => {
				if (!blob) {
					frappe.msgprint(__("无法读取当前画面，请重试。"));
					return;
				}

				revoke_url(state.current_capture_url);
				state.current_capture_url = URL.createObjectURL(blob);
				crop_image.onload = () => setup_cropper(state, crop_image, $root);
				crop_image.src = state.current_capture_url;
				$root.removeClass("mode-capture").addClass("mode-crop");
				$status.text(__("正在裁剪当前页..."));
			},
			"image/jpeg",
			0.96
		);
	}

	function setup_cropper(state, crop_image, $root) {
		destroy_cropper(state);
		state.cropper = new Cropper(crop_image, {
			viewMode: 1,
			autoCropArea: 0.96,
			background: false,
			zoomable: true,
			scalable: true,
			movable: true,
			responsive: true,
			restore: false,
			guides: true,
			center: true,
			highlight: false,
			cropBoxMovable: true,
			cropBoxResizable: true,
			toggleDragModeOnDblclick: false,
			dragMode: "move",
			ready() {
				apply_aspect_ratio(state.cropper, read_scan_params($root).aspect_ratio);
				state.preview_applied = false;
			},
			crop() {
				if (!state.suspend_dirty_flag) state.preview_applied = false;
			},
			zoom() {
				if (!state.suspend_dirty_flag) state.preview_applied = false;
			},
		});
	}

	function rotate_cropper(state, degrees) {
		if (!state.cropper) return;
		state.preview_applied = false;
		state.cropper.rotate(degrees);
	}

	function apply_filter($root, state) {
		if (!state.cropper || state.uploading) return;

		frappe.show_alert({ message: __("正在处理图像..."), indicator: "blue" });
		const params = read_scan_params($root);
		const cropped_canvas = get_cropper_canvas(state.cropper);
		const enhanced_canvas = enhance_cropped_canvas(cropped_canvas, params);

		state.suspend_dirty_flag = true;
		state.cropper.replace(enhanced_canvas.toDataURL("image/jpeg", params.jpeg_quality));

		setTimeout(() => {
			state.preview_applied = true;
			state.suspend_dirty_flag = false;
		}, 120);

		frappe.show_alert({ message: __("增强已应用"), indicator: "green" });
	}

	async function confirm_current_page({ dialog, state, $root, $gallery, $status }) {
		if (!state.cropper || state.uploading) return;

		set_scanner_busy($root, true);
		try {
			const params = read_scan_params($root);
			let final_canvas = get_cropper_canvas(state.cropper);
			if (!state.preview_applied) {
				final_canvas = enhance_cropped_canvas(final_canvas, params);
			}

			const blob = await canvas_to_blob(final_canvas, "image/jpeg", params.jpeg_quality);
			state.scanned_pages.push({
				blob,
				url: URL.createObjectURL(blob),
				width: final_canvas.width,
				height: final_canvas.height,
			});

			render_gallery($gallery, state);
			update_counts($root, state);
			update_primary_state(dialog, state);
			destroy_cropper(state);
			state.preview_applied = false;
			$root.removeClass("mode-crop").addClass("mode-capture");
			$status.text(__("实时取景中"));
		} catch (error) {
			frappe.msgprint({
				title: __("处理失败"),
				indicator: "red",
				message: error.message || String(error),
			});
		} finally {
			set_scanner_busy($root, false);
		}
	}

	function get_cropper_canvas(cropper) {
		return cropper.getCroppedCanvas({
			fillColor: "#ffffff",
			maxWidth: MAX_IMAGE_WIDTH,
			maxHeight: MAX_IMAGE_HEIGHT,
			imageSmoothingEnabled: true,
			imageSmoothingQuality: "high",
		});
	}

	function enhance_cropped_canvas(source_canvas, params) {
		const canvas = document.createElement("canvas");
		canvas.width = source_canvas.width;
		canvas.height = source_canvas.height;

		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(source_canvas, 0, 0);

		let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imgData.data;
		const is_original = params.enhance_preset === "original";
		const contrast_factor = (259 * (params.contrast + 255)) / (255 * (259 - params.contrast));

		for (let i = 0; i < data.length; i += 4) {
			if (is_original) {
				data[i] = clamp(contrast_factor * (data[i] - 128) + 128 + params.brightness);
				data[i + 1] = clamp(contrast_factor * (data[i + 1] - 128) + 128 + params.brightness);
				data[i + 2] = clamp(contrast_factor * (data[i + 2] - 128) + 128 + params.brightness);
				continue;
			}

			let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			gray = clamp(contrast_factor * (gray - 128) + 128 + params.brightness);

			if (params.white_bg) {
				if (gray >= params.threshold) {
					gray = 255;
				} else if (params.enhance_preset === "bw_strong" || params.enhance_preset === "receipt") {
					gray = gray < params.threshold - 24 ? 0 : clamp(gray - 55);
				} else if (params.enhance_preset === "light_text") {
					gray = gray < params.threshold - 18 ? clamp(gray - 35) : gray;
				} else {
					gray = gray < params.threshold - 20 ? clamp(gray - 28) : gray;
				}
			}

			data[i] = gray;
			data[i + 1] = gray;
			data[i + 2] = gray;
		}

		if (params.sharpen > 0) {
			imgData = apply_sharpen(imgData, params.sharpen / 100);
		}

		if (!is_original && params.white_bg) {
			const d2 = imgData.data;
			for (let i = 0; i < d2.length; i += 4) {
				if (d2[i] > params.threshold + 8) {
					d2[i] = 255;
					d2[i + 1] = 255;
					d2[i + 2] = 255;
				}
			}
		}

		ctx.putImageData(imgData, 0, 0);
		return canvas;
	}

	function apply_sharpen(imageData, amount) {
		const width = imageData.width;
		const height = imageData.height;
		const src = new Uint8ClampedArray(imageData.data);
		const out = imageData.data;
		const stride = width * 4;

		for (let y = 1; y < height - 1; y++) {
			for (let x = 1; x < width - 1; x++) {
				const idx = y * stride + x * 4;
				for (let c = 0; c < 3; c++) {
					const center = src[idx + c];
					const sharpened =
						5 * center - src[idx - stride + c] - src[idx + stride + c] - src[idx - 4 + c] - src[idx + 4 + c];
					out[idx + c] = clamp(center * (1 - amount) + sharpened * amount);
				}
				out[idx + 3] = src[idx + 3];
			}
		}

		return imageData;
	}

	function clamp(v) {
		return Math.max(0, Math.min(255, Math.round(v)));
	}

	async function start_camera(video_element, state, $status) {
		try {
			$status.text(__("正在启动摄像头..."));
			try {
				state.stream = await navigator.mediaDevices.getUserMedia({
					video: {
						facingMode: "environment",
						width: { ideal: 1920 },
						height: { ideal: 1080 },
					},
					audio: false,
				});
			} catch (error) {
				state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			}
			video_element.srcObject = state.stream;
			$status.text(__("实时取景中"));
		} catch (error) {
			$status.text(__("摄像头不可用"));
			frappe.msgprint(__("无法调用摄像头，请检查浏览器权限。报错: ") + error.message);
		}
	}

	function destroy_cropper(state) {
		if (state.cropper) {
			state.cropper.destroy();
			state.cropper = null;
		}
	}

	function cleanup_scanner(state) {
		if (state.stream) {
			state.stream.getTracks().forEach((track) => track.stop());
			state.stream = null;
		}
		destroy_cropper(state);
		revoke_url(state.current_capture_url);
		state.current_capture_url = null;
		state.scanned_pages.forEach((page) => revoke_url(page.url));
		state.scanned_pages = [];
	}

	function render_gallery($gallery, state) {
		if (!state.scanned_pages.length) {
			$gallery.html(`<div class="document-scan-empty">${__("尚未拍摄任何页面")}</div>`);
			return;
		}

		const html = state.scanned_pages
			.map(
				(page, idx) => `
					<div class="document-scan-thumb">
						<div class="document-scan-thumb-box">
							<img src="${page.url}" alt="${escape_html(__("第 {0} 页", [idx + 1]))}">
							<button class="document-scan-thumb-remove" data-index="${idx}" title="${__("删除")}">x</button>
						</div>
						<div class="document-scan-thumb-no">${__("第 {0} 页", [idx + 1])}</div>
					</div>
				`
			)
			.join("");

		$gallery.html(html);
		if ($gallery[0]) {
			$gallery.scrollLeft($gallery[0].scrollWidth);
		}
	}

	function update_counts($root, state) {
		$root.find('[data-role="page-counter"]').text(state.scanned_pages.length);
		$root.find('[data-role="gallery-count"]').text(state.scanned_pages.length);
	}

	function update_primary_state(dialog, state) {
		dialog.get_primary_btn().prop("disabled", !state.scanned_pages.length || state.uploading);
	}

	function set_scanner_busy($root, busy) {
		$root.toggleClass("is-busy", Boolean(busy));
	}

	async function generate_and_upload_pdf({ dialog, state, $root, upload_context, file_uploader }) {
		state.uploading = true;
		update_primary_state(dialog, state);
		set_scanner_busy($root, true);

		frappe.show_alert({
			message: __("正在合成多页 PDF 并上传，请稍候..."),
			indicator: "blue",
		});

		try {
			const params = read_scan_params($root);
			const { jsPDF } = window.jspdf;
			let pdf = null;

			for (let index = 0; index < state.scanned_pages.length; index++) {
				const page = state.scanned_pages[index];
				const imgData = await blob_to_data_url(page.blob);
				const img_ratio = page.width / page.height;
				const page_mode = resolve_pdf_mode(params.pdf_mode, img_ratio);
				const orientation = page_mode === "a4_landscape" ? "l" : "p";

				if (index === 0) {
					pdf = new jsPDF(orientation, "mm", "a4");
				} else {
					pdf.addPage("a4", orientation);
				}

				add_image_to_pdf_page(pdf, imgData);
				await next_frame();
			}

			const filename = make_scan_filename();
			const upload_result = await upload_file_multipart({
				file: new File([pdf.output("blob")], filename, { type: "application/pdf" }),
				filename,
				doctype: upload_context.doctype,
				docname: upload_context.docname,
				fieldname: upload_context.fieldname,
				folder: upload_context.folder,
				method: upload_context.method,
				is_private: params.is_private,
			});

			await run_native_success_handler({ upload_result, file_uploader, upload_context });

			frappe.show_alert({ message: __("扫描件已成功归档"), indicator: "green" });
			dialog.hide();
		} catch (error) {
			console.error(error);
			frappe.msgprint({
				title: __("上传失败"),
				message: error.message || String(error),
				indicator: "red",
			});
		} finally {
			state.uploading = false;
			update_primary_state(dialog, state);
			set_scanner_busy($root, false);
		}
	}

	function resolve_pdf_mode(mode, img_ratio) {
		if (mode === "auto") {
			return img_ratio > 1 ? "a4_landscape" : "a4_portrait";
		}
		return mode;
	}

	function add_image_to_pdf_page(pdf, imgData) {
		const pageWidth = pdf.internal.pageSize.getWidth();
		const pageHeight = pdf.internal.pageSize.getHeight();
		const margin = 8;
		const props = pdf.getImageProperties(imgData);
		const usableWidth = pageWidth - margin * 2;
		const usableHeight = pageHeight - margin * 2;
		const ratio = Math.min(usableWidth / props.width, usableHeight / props.height);
		const renderWidth = props.width * ratio;
		const renderHeight = props.height * ratio;
		const x = (pageWidth - renderWidth) / 2;
		const y = (pageHeight - renderHeight) / 2;

		pdf.addImage(imgData, "JPEG", x, y, renderWidth, renderHeight);
	}

	async function upload_file_multipart({
		file,
		filename,
		doctype,
		docname,
		fieldname,
		folder,
		method,
		is_private,
	}) {
		const url =
			frappe.urllib && frappe.urllib.get_full_url
				? frappe.urllib.get_full_url("/api/method/upload_file")
				: "/api/method/upload_file";
		const fd = new FormData();

		fd.append("file", file, filename || file.name);
		fd.append("is_private", String(is_private ? 1 : 0));
		fd.append("folder", folder || "Home");
		if (doctype) fd.append("doctype", doctype);
		if (docname) fd.append("docname", docname);
		if (fieldname) fd.append("fieldname", fieldname);
		if (method) fd.append("method", method);
		if (frappe.csrf_token) fd.append("csrf_token", frappe.csrf_token);

		const resp = await fetch(url, {
			method: "POST",
			body: fd,
			headers: frappe.csrf_token ? { "X-Frappe-CSRF-Token": frappe.csrf_token } : {},
		});

		let response = null;
		try {
			response = await resp.json();
		} catch (error) {
			// Non-JSON failures are handled below with status text.
		}

		if (!resp.ok || response?.exc) {
			throw new Error(get_upload_error_message(resp, response));
		}

		const message = response?.message || {};
		return {
			response,
			message,
			file_doc: message?.doctype === "File" ? message : null,
		};
	}

	async function run_native_success_handler({ upload_result, file_uploader, upload_context }) {
		const native_on_success =
			file_uploader?.document_scanner_upload_options?.on_success || upload_context.on_success;

		if (typeof native_on_success === "function") {
			await Promise.resolve(native_on_success(upload_result.file_doc, upload_result.response));
			return;
		}

		const file_doc = upload_result.file_doc || upload_result.message;
		if (upload_context.fieldname && upload_context.doctype && upload_context.docname && file_doc?.file_url) {
			await frappe.model.set_value(
				upload_context.doctype,
				upload_context.docname,
				upload_context.fieldname,
				file_doc.file_url
			);
		}

		const frm = upload_context.frm;
		if (file_doc?.doctype === "File" && frm?.attachments?.attachment_uploaded) {
			frm.attachments.attachment_uploaded(file_doc);
		} else if (frm?.sidebar?.reload_docinfo) {
			frm.sidebar.reload_docinfo();
		}
	}

	function get_upload_error_message(resp, response) {
		if (response?._server_messages) {
			try {
				const messages = JSON.parse(response._server_messages)
					.map((message) => JSON.parse(message).message)
					.filter(Boolean);
				if (messages.length) return messages.join("<br>");
			} catch (error) {
				// Fall through to the generic message.
			}
		}
		return response?.exception || response?.exc_type || resp.statusText || __("上传请求失败");
	}

	function make_scan_filename() {
		const timestamp = frappe.datetime.now_datetime().replace(/[-: ]/g, "");
		return `Scan_${timestamp}.pdf`;
	}

	function canvas_to_blob(canvas, type, quality) {
		return new Promise((resolve, reject) => {
			canvas.toBlob(
				(blob) => {
					if (blob) resolve(blob);
					else reject(new Error(__("无法生成扫描图片。")));
				},
				type,
				quality
			);
		});
	}

	function blob_to_data_url(blob) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(reader.error || new Error(__("无法读取扫描图片。")));
			reader.readAsDataURL(blob);
		});
	}

	function next_frame() {
		return new Promise((resolve) => requestAnimationFrame(resolve));
	}

	function revoke_url(url) {
		if (url) URL.revokeObjectURL(url);
	}

	function escape_html(str) {
		return String(str || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}
})();
